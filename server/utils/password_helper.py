import asyncpg
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from typing import Annotated
from dotenv import load_dotenv, set_key
from fastapi import Depends, FastAPI, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
import os

from utils.types_custom import TokenData, UserInDB

load_dotenv()

app = FastAPI()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- Password helpers ---


def verify_password(plain: str | None, hashed: str | None) -> bool:
    if plain is None or hashed is None or plain.strip() == "":
        return False
    else:
        return bcrypt.checkpw(plain.encode(), hashed.encode())


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def generateRandomKey() -> str:
    # generate a random (time based) Key
    currentTime = datetime.now().strftime("%d/%m/%Y, %H:%M:%S")
    return get_password_hash(currentTime)


def setRandomKey(value: str, key: str = "SECRET_KEY") -> str:
    # set the new key in the .env and return it again
    set_key(".env", key, value)
    return value


# Defined after get_password_hash
DUMMY_HASH = get_password_hash("dummy")

SECRET_KEY = os.getenv("SECRET_KEY") or setRandomKey(
    generateRandomKey(), "SECRET_KEY"
)  # get secret key or set a rand one
ALGORITHM = os.getenv("ALGORITHM") or "HS256"


# --- DB ---


async def get_user(con: asyncpg.Connection, username: str | None) -> UserInDB | None:
    if not username:
        return None
    row = await con.fetchrow(
        "SELECT username, password_hash FROM users WHERE username = $1", username
    )
    if row is None:
        return None
    return UserInDB(username=row["username"], hashed_password=row["password_hash"])


# --- Token helpers ---


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=15))
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> str | None:
    try:
        if token.__contains__(" "):
            token = token.split(" ")[1]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError as e:
        print(f"JWT decode error: {e}")
        return None


# --- Auth logic ---


async def add_user_to_db(
    con: asyncpg.pool.PoolConnectionProxy, username: str, password: str
) -> None:
    hashed_passwd = get_password_hash(password)
    await con.execute(
        "insert into users (username, password_hash) values ($1, $2)",
        username,
        hashed_passwd,
    )


async def authenticate_user(
    con: asyncpg.pool.PoolConnectionProxy,
    username: str,
    password: str,
    createUserIfNeeded: bool = True,
) -> UserInDB | bool:

    user = await get_user(con, username)  # type: ignore
    print(user)
    if not user:
        if not createUserIfNeeded:
            verify_password(password, DUMMY_HASH)  # constant-time rejection
            return False
        else:
            await add_user_to_db(con, username, password)
            user = await get_user(con, username)  # type: ignore
    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user or False


async def get_current_user(
    request: Request,
    token: Annotated[str, Depends(oauth2_scheme)],
) -> UserInDB:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except InvalidTokenError:
        raise credentials_exception

    async with request.app.state.pool.acquire() as con:
        user = await get_user(con, token_data.username)
    if user is None:
        raise credentials_exception
    return user


async def get_current_active_user(
    current_user: Annotated[UserInDB, Depends(get_current_user)],
) -> UserInDB:
    if current_user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user
