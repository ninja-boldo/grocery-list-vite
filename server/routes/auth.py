import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm

from utils.api_helpers import getUsernameFromReq
from utils.types_custom import Token, ChangePasswordRequest
from utils.password_helper import (
    authenticate_user,
    create_access_token,
    get_password_hash,
    get_user,
    verify_password,
)

router = APIRouter(prefix="", tags=["auth"])


@router.post("/token")
async def login_for_access_token(
    request: Request,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> Token:
    import datetime as dt

    username = form_data.username.lower()
    async with request.app.state.pool.acquire() as con:
        user = await authenticate_user(con, username, form_data.password)
        ACCESS_TOKEN_EXPIRE_SECONDS = int(
            os.getenv("ACCESS_TOKEN_EXPIRE_SECONDS") or 30 * 60
        )
        if not user:
            raise HTTPException(
                status_code=401,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        access_token = create_access_token(
            data={"sub": username},
            expires_delta=dt.timedelta(seconds=ACCESS_TOKEN_EXPIRE_SECONDS),
        )
        return Token(access_token=access_token, token_type="bearer")


@router.post("/change_password")
async def change_password(request: Request, body: ChangePasswordRequest):
    minPasswordLength = int(os.getenv("MIN_PASSWORD_LENGTH", 4))
    if len(body.new_password) < minPasswordLength:
        raise HTTPException(
            status_code=400, detail="New password must be at least 8 characters"
        )

    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from current password",
        )

    username = getUsernameFromReq(request)
    if not username:
        raise HTTPException(status_code=401, detail="Unauthorized")

    async with request.app.state.pool.acquire() as con:
        user = await get_user(con, username)
        if not user or not verify_password(body.current_password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        hashed_password = get_password_hash(body.new_password)
        await con.execute(
            "UPDATE users SET password_hash = $1 WHERE username = $2",
            hashed_password,
            username,
        )

    return {"done": True}
