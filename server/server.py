import os
import traceback
from zoneinfo import ZoneInfo
from dateutil import parser

import httpx
from utils.dbManager import DatabaseManager
from utils.api_helpers import (
    convert_timestamps_to_dates,
    safe_int,
    sanitize_string,
    validate_wish_list,
)
from utils.query_builder import build_fetch_query
from utils.item_service import resolve_item_identity, perform_item_operation
from utils.text_processing import shortenWithTable
from enum import Enum
import requests
from dotenv import load_dotenv

os.environ["KMP_DUPLICATE_LIB_OK"] = "True"

import datetime as dt
import json
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import (
    FastAPI,
    File,
    Query,
    Request,
    UploadFile,
    HTTPException,
)
import uvicorn

from fastapi.responses import JSONResponse

from prometheus_fastapi_instrumentator import Instrumentator

import time
import logging
from logging_loki import LokiHandler

import asyncpg
from functools import lru_cache
import asyncio

from logging.handlers import QueueHandler, QueueListener, RotatingFileHandler
import queue
import atexit

from utils.types import *
from utils.password_helper import *
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(".env")
key = os.getenv("GROQ_API_KEY")
if not key:
    raise Exception("GROQ_API_KEY not set or empty")


# ============================================================================
# CONFIGURATION - All settings in one place
# ============================================================================
class Config:
    # Feature toggles
    ENABLE_WHISPER_MODEL_LOCAL = False
    ENABLE_WHISPER_MODEL_CLOUD = True
    ENABLE_LOKI_LOGGING = False
    ENABLE_PROMETHEUS = True
    ENABLE_FILE_LOGGING = True

    # Database settings
    DB_POOL_MIN_SIZE = 10
    DB_POOL_MAX_SIZE = 20
    DB_COMMAND_TIMEOUT = 30
    DB_RETRY_ATTEMPTS = 10
    DB_RETRY_DELAY = 2.0

    # Cache settings
    LRU_CACHE_SIZE = 20

    # Logging settings
    LOG_FILE_MAX_SIZE = 5 * 1024 * 1024
    LOG_FILE_BACKUP_COUNT = 2

    # Loki settings
    LOKI_URL = "http://192.168.1.13:3100"

    # Backend proxy URL
    BACKEND_URL = "http://192.168.1.165:3030"

    @classmethod
    def get_database_url(cls) -> str:
        if os.getenv("RUNNING_IN_CONTAINER"):
            return "postgresql://postgres:postgres@postgres-db:5432/maindb"
        return "postgresql://postgres:postgres@127.0.0.1:5432/maindb"

    @classmethod
    def get_csv_path(cls) -> str:
        if os.getenv("RUNNING_IN_CONTAINER"):
            return "/app/openfoodfacts.csv"
        return "openfoodfacts.csv"


# Validate conflicting settings
if Config.ENABLE_WHISPER_MODEL_CLOUD and Config.ENABLE_WHISPER_MODEL_LOCAL:
    raise ValueError(
        "Cannot enable both WHISPER_MODEL_LOCAL and WHISPER_MODEL_CLOUD simultaneously"
    )

# Conditional imports
if Config.ENABLE_WHISPER_MODEL_CLOUD:
    from transcript_classify.transcript import transcribe
    from transcript_classify import classifier


# ============================================================================
# LOGGING SETUP
# ============================================================================
logger = logging.getLogger("fastapi-logger")
logger.handlers.clear()


class ListTypes(Enum):
    wishList = "wish_list"
    itemList = "item_list"


class SafeLokiHandler(LokiHandler):
    """Loki handler with graceful fallback"""

    def __init__(self, *args, **kwargs):
        self.fallback_handler = logging.StreamHandler()
        self.fallback_handler.setLevel(logging.INFO)
        self.fallback_handler.setFormatter(
            logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        )
        self._loki_available = True
        super().__init__(*args, **kwargs)

    def emit(self, record):
        if self._loki_available:
            try:
                super().emit(record)
            except Exception:
                self._loki_available = False
                self.fallback_handler.emit(record)
        else:
            self.fallback_handler.emit(record)


def setup_logging() -> tuple[QueueListener, logging.Logger]:
    """Setup robust async logging with conditional handlers"""
    log_queue = queue.Queue()
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    handlers = []

    # Console handler (always enabled)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    handlers.append(console_handler)

    # File handler (conditional)
    if Config.ENABLE_FILE_LOGGING:
        file_handler = RotatingFileHandler(
            "server.log",
            maxBytes=Config.LOG_FILE_MAX_SIZE,
            backupCount=Config.LOG_FILE_BACKUP_COUNT,
        )
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(formatter)
        handlers.append(file_handler)

    # Loki handler (conditional with connection test)
    if Config.ENABLE_LOKI_LOGGING:
        try:
            response = requests.get(f"{Config.LOKI_URL}/ready", timeout=2)
            if response.status_code == 200:
                loki_handler = SafeLokiHandler(
                    url=f"{Config.LOKI_URL}/loki/api/v1/push",
                    tags={"application": "grocery-list", "environment": "development"},
                    version="1",
                )
                handlers.append(loki_handler)
                print("✓ Loki logging connected")
        except Exception as e:
            print(f"⚠ Loki unavailable: {e}")

    # Setup queue-based async logging
    queue_listener = QueueListener(log_queue, *handlers, respect_handler_level=True)
    queue_handler = QueueHandler(log_queue)

    logger.addHandler(queue_handler)
    logger.setLevel(logging.INFO)
    queue_listener.start()

    print(f"✓ Logging initialized with {len(handlers)} handler(s)")
    return queue_listener, logger


queue_listener, logger = setup_logging()
atexit.register(lambda: queue_listener.stop() if queue_listener else None)

DATABASE_SCHEMA = {
    "items": {
        "main": """CREATE TABLE IF NOT EXISTS "items" (
            "item_id" TEXT NOT NULL UNIQUE,
            "item_name" TEXT DEFAULT NULL,
            "image_url" TEXT DEFAULT NULL,
            "shortened_name" TEXT DEFAULT NULL,
            "last_checked_at" TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY("item_id", "item_name")
        );""",
        "index": """CREATE INDEX IF NOT EXISTS "items_index_0" ON "items" ("item_id", "item_name");""",
    },
    "users": {
        "main": """CREATE TABLE IF NOT EXISTS "users" (
            "user_id" INTEGER NOT NULL UNIQUE GENERATED BY DEFAULT AS IDENTITY,
            "password_hash" TEXT,
            "username" TEXT,
            PRIMARY KEY("user_id")
        );""",
        "index": """CREATE INDEX IF NOT EXISTS "users_index_0" ON "users" ("user_id", "username", "password_hash");""",
    },
    "inventory": {
        "main": """CREATE TABLE IF NOT EXISTS "inventory" (
            "id" INTEGER NOT NULL UNIQUE GENERATED BY DEFAULT AS IDENTITY,
            "item_id" TEXT,
            "user_id" INTEGER,
            "count" INTEGER,
            "is_wish" BOOLEAN,
            "created_at" TIMESTAMPTZ,
            PRIMARY KEY("id")
        );""",
        "index": """CREATE INDEX IF NOT EXISTS "inventory_index_0" ON "inventory" ("user_id", "is_wish", "created_at", "item_id", "id");""",
    },
    "item_classification": {
        "main": """CREATE TABLE IF NOT EXISTS "item_classification" (
            "item_id" TEXT NOT NULL UNIQUE,
            "categories_off" TEXT DEFAULT NULL,
            "class" TEXT DEFAULT NULL,
            "mapped_wishes" TEXT DEFAULT NULL,
            PRIMARY KEY("item_id")
        );""",
        "index": None,
    },
    "wish_mapping": {
        "main": """CREATE TABLE IF NOT EXISTS "wish_mapping" (
            "item_id" TEXT NOT NULL UNIQUE,
            "wish" TEXT DEFAULT NULL,
            PRIMARY KEY("item_id")
        );""",
        "index": None,
    },
    "foreign_keys": [
        """ALTER TABLE "inventory" ADD FOREIGN KEY("item_id") REFERENCES "items"("item_id") ON UPDATE NO ACTION ON DELETE NO ACTION;""",
        """ALTER TABLE "inventory" ADD FOREIGN KEY("user_id") REFERENCES "users"("user_id") ON UPDATE NO ACTION ON DELETE NO ACTION;""",
        """ALTER TABLE "item_classification" ADD FOREIGN KEY("item_id") REFERENCES "items"("item_id") ON UPDATE NO ACTION ON DELETE NO ACTION;""",
        """ALTER TABLE "wish_mapping" ADD FOREIGN KEY("item_id") REFERENCES "items"("item_id") ON UPDATE NO ACTION ON DELETE NO ACTION;""",
    ],
}


async def ensure_schema(pool: asyncpg.Pool) -> None:
    try:
        async with pool.acquire() as con:
            for table_name, table in DATABASE_SCHEMA.items():
                if table_name == "foreign_keys":
                    continue
                try:
                    await con.execute(table["main"])
                    if table["index"] is not None:
                        await con.execute(table["index"])
                    logger.info(f"executing init for table with name: {table_name}")
                except Exception as error:
                    logger.error(f"failed for table creation of {table_name} with this error: {error}")

            for foreign_key_statement in DATABASE_SCHEMA["foreign_keys"]:
                try:
                    await con.execute(foreign_key_statement)
                except asyncpg.exceptions.DuplicateObjectError:
                    pass
                except Exception as error:
                    logger.error(f"failed for this foreign key init: {foreign_key_statement} with this error: {error}")

    except Exception as error:
        logger.error(f"failed in ensure schema with this error: {error}")


async def init_database(pool: asyncpg.Pool):
    """
    Initialize database with schema-driven approach.

    This function:
    1. Ensures all tables match the defined schema (creates/updates as needed)
    2. Attempts to load data from SQL dump or CSV if tables are empty
    3. Is idempotent and safe to run multiple times
    4. Will not fail if no data sources are available
    """
    try:
        logger.info("Starting database initialization...")

        # Step 1: Ensure schema compliance (always runs)
        await ensure_schema(pool)
        logger.info("✓ Schema compliance verified")

        # Step 2: Final status report
        async with pool.acquire() as con:
            tables_info = []
            for table_name in DATABASE_SCHEMA.keys():
                if not table_name == "foreign_keys":
                    count = await con.fetchval(f"SELECT COUNT(*) FROM {table_name}") or 0
                    tables_info.append(f"{table_name}({count} rows)")

            logger.info(
                f"✓ Database initialized successfully: {', '.join(tables_info)}"
            )

    except Exception as e:
        logger.exception(f"Critical database initialization error: {e}")
        raise


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def reformatTimeStamp(ts, fmt="%d.%m.%Y"):
    if isinstance(ts, list):
        ts = ts[0]
    if isinstance(ts, dt.datetime):
        return ts.strftime(fmt)
    return parser.parse(str(ts)).strftime(fmt)

def convertToBerlinTime(currentDatetime: dt.datetime | None, tz: ZoneInfo = ZoneInfo("Europe/Berlin")) -> dt.datetime:
    if currentDatetime is None:
        return dt.datetime.now()
    else:
        if currentDatetime.tzinfo is None:
            newDatetime = currentDatetime.replace(tzinfo=tz)
        else:
            newDatetime = currentDatetime.astimezone(tz)
        return newDatetime

async def itemInStock(con: asyncpg.pool.PoolConnectionProxy, userId: int, ean: str):
    res = await con.fetch("select item_id from inventory where user_id = $1 and item_id = $2", userId, ean)
    return len(res) > 0

async def itemIsKnown(con: asyncpg.pool.PoolConnectionProxy, ean: str | None) -> bool:
    if ean is None:
        return False
    res = await con.fetch("select item_id from items where item_id = $1", ean)
    return len(res) > 0


async def handleManualItems(con: asyncpg.pool.PoolConnectionProxy, item_name: str, count: int, userId: int, is_wish: bool, date: dt.datetime) -> dict:
    import hashlib
    # Use a stable hash of the item name as the item_id so that different
    # manual items don't all collapse onto the same "-1" row in inventory joins.
    item_id = "manual-" + hashlib.sha1(item_name.lower().strip().encode()).hexdigest()[:12]
    try:
        await con.execute(
            "INSERT INTO items (item_id, item_name) VALUES ($1, $2) ON CONFLICT (item_id) DO NOTHING",
            item_id, item_name
        )
        await con.execute(
            "INSERT INTO item_classification (item_id) VALUES ($1) ON CONFLICT (item_id) DO NOTHING",
            item_id
        )
        
        await con.execute("""
                                INSERT INTO inventory (item_id, user_id, count, is_wish, created_at)
                                SELECT $1, $2, 1, $3, $4
                                FROM generate_series(1, $5)
                            """, item_id, userId, is_wish, date, count)
        return {"state": "success", "operation": "add", "mode": "manual adding"}
    except Exception as e:
        logger.error(f"handleManualItems failed: {e}")
        logger.error(traceback.format_exc())
        return {"state": "error", "operation": "add", "mode": "manual adding", "error": str(e)}

async def addItemToInventory(http_client: httpx.AsyncClient, pool: asyncpg.Pool, username: str | None, ean: str | None,
                             item_name: str | None, count: int, is_wish: bool, date: dt.datetime | None = None) -> dict:
    try:
        logger.info("we are in addItemToInventory")
        if not username:
            raise ValueError(f"the username shouldnt be none for this function call")

        if not ean and not username:
            return {"state": "error", "operation": "unknown", "error": "you need either the ean or the item name to be set"}

        dateNormalized = convertToBerlinTime(date) if date else dt.datetime.now(ZoneInfo("Europe/Berlin"))

        async with pool.acquire() as con:
            userId: int | None = await con.fetchval(
                "SELECT user_id FROM users WHERE username = $1", username
            )
            if userId is None:
                return {"state": "error", "operation": "unknown", "error": f"user '{username}' not found"}

            if count >= 1:
                try:
                    logger.info("we are in count >= 1")

                    if not ean:
                        return await handleManualItems(con, item_name, count, userId, is_wish, dateNormalized)
                    else:
                        itemKnown = await itemIsKnown(con, ean)
                        if not itemKnown and not item_name:
                            item_name = await getItemNameAsync(http_client, ean=ean, logger=logger, delay=0.0)

                        if not itemKnown:
                            await con.execute("""
                                    INSERT INTO items (item_id, item_name, last_checked_at)
                                    VALUES ($1, $2, now())
                                    ON CONFLICT (item_id) DO NOTHING
                                """, ean, item_name)
                            await con.execute(
                                "INSERT INTO item_classification (item_id) VALUES ($1) ON CONFLICT (item_id) DO NOTHING",
                                ean
                            )

                        await con.execute("""
                            INSERT INTO inventory (item_id, user_id, count, is_wish, created_at)
                            SELECT $1, $2, 1, $3, $4
                            FROM generate_series(1, $5)
                        """, ean, userId, is_wish, dateNormalized, count)

                        return {"state": "success", "operation": "add"}
                except Exception as e:
                    logger.error(f"addItemToInventory add branch failed: {e}")
                    logger.error(traceback.format_exc())
                    return {"state": "error", "operation": "add", "error": str(e)}

            elif count <= -1:
                try:
                    logger.info("we are in count <= -1")
                    import hashlib
                    effective_id = ean if ean else "manual-" + hashlib.sha1((item_name or "").lower().strip().encode()).hexdigest()[:12]
                    if await itemInStock(con, userId, effective_id):
                        await con.execute("""
                            DELETE FROM inventory WHERE ctid IN (
                                SELECT ctid FROM inventory
                                WHERE item_id = $1 AND user_id = $2
                                ORDER BY created_at ASC
                                LIMIT $3
                            )
                        """, effective_id, userId, abs(count))
                    else:
                        logger.info("nothing deletable")
                    return {"state": "success", "operation": "delete"}
                except Exception as e:
                    logger.error(f"addItemToInventory delete branch failed: {e}")
                    logger.error(traceback.format_exc())
                    return {"state": "error", "operation": "delete", "error": str(e)}
            else:
                logger.info("we are in the else clause")
                return {"state": "success", "operation": "nothing", "error": f"wont do anything for count {count}"}
    except Exception as e:
        logger.error(f"addItemToInventory failed with this error: {e}")
        return {"state": "error", "operation": "unknown", "error": str(e)}

async def getItemNameAsync(client: httpx.AsyncClient, ean: str, logger: logging.Logger, delay: float = 0.5):
    try:
        await asyncio.sleep(delay)
        res = await client.get(
                    f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=product_name",
                    timeout=5.0,
                )
        data = res.json()
        if not data["status_verbose"] == "product found":
            logger.error(f"couldnt resolve item name for ean {ean}")
            return "none"
        return data["product"]["product_name"]
    except Exception as e:
        raise Exception(f"failed with this error: {e}")

async def getImageUrlAsync(
    client: httpx.AsyncClient, ean: str, delay: float = 0.5
) -> str:
    try:
        if ean.__contains__("manual"):
            return ""
        await asyncio.sleep(delay)
        res = await client.get(
            f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=selected_images",
            timeout=5.0,
        )
        data = res.json()
        images = data["product"]["selected_images"]["front"]["display"]
        for lang in ("en", "de", "fr", "es"):
            if lang in images:
                return images[lang]
    except Exception as e:
        logger.warning(f"Failed to fetch image for ean {ean}: {e}")
    return ""


# ============================================================================
# APPLICATION LIFESPAN
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager with self-healing initialization"""
    daemon_tasks = []
    http_client: httpx.AsyncClient | None = None
    try:
        # Initialize database pool with retry
        for attempt in range(Config.DB_RETRY_ATTEMPTS):
            try:
                app.state.pool = await asyncpg.create_pool(
                    Config.get_database_url(),
                    min_size=Config.DB_POOL_MIN_SIZE,
                    max_size=Config.DB_POOL_MAX_SIZE,
                    command_timeout=Config.DB_COMMAND_TIMEOUT,
                    server_settings={"jit": "off"},
                )
                logger.info("Database pool created successfully")
                break
            except Exception as e:
                logger.error(
                    f"Database pool creation failed (attempt {attempt + 1}): {e}"
                )
                if attempt < Config.DB_RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(Config.DB_RETRY_DELAY * (attempt + 1))
                else:
                    raise

        # Initialize database manager
        app.state.db = DatabaseManager(app.state.pool, logger)

        http_client = httpx.AsyncClient(
            headers={"User-Agent": "grocery-list-app/1.0"}, timeout=httpx.Timeout(5.0)
        )
        app.state.http_client = http_client

        # Initialize database schema
        await init_database(app.state.pool)

        # Start background daemon tasks (run once at startup)
        daemon_tasks.append(asyncio.create_task(shortenItemNamesDaemon(app.state.pool)))
        logger.info("✓ Started item name shortening daemon")

        # schedule tag assignment for item grouping
        daemon_tasks.append(asyncio.create_task(assignTagsTask(app.state.pool)))
        logger.info("✓ Started tag assignment daemon")

        daemon_tasks.append(asyncio.create_task(mapItemToWishDaemon(app.state.pool)))
        logger.info("✓ Started item to wish mapping daemon")

        daemon_tasks.append(
            asyncio.create_task(rescanImageUrlsDaemon(app.state.pool))
        )
        logger.info("✓ Started image url rescanning daemon")
        yield

    finally:
        # cancel daemon task on shutdown
        if daemon_tasks:
            for idx, daemon in enumerate(daemon_tasks):
                daemon.cancel()
                try:
                    await daemon
                except asyncio.CancelledError:
                    logger.info(f"{idx + 1}. Daemon task cancelled")

        client = getattr(app.state, "http_client", None)
        if client and not client.is_closed:
            await client.aclose()
            logger.info("async http client closed")
        if hasattr(app.state, "pool") and app.state.pool:
            await app.state.pool.close()
            logger.info("Database pool closed")


# ============================================================================
# APPLICATION SETUP
# ============================================================================
app = FastAPI(lifespan=lifespan, debug=False)

# Prometheus metrics (conditional)
if Config.ENABLE_PROMETHEUS:
    Instrumentator().instrument(app).expose(app)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.middleware("http")
async def request_middleware(request: Request, call_next):
    """Request logging and error handling middleware"""
    start_time = time.time()

    try:
        auth_needed_endpoints = ["/fetch_items", "/add_ean_to_list/",
                                 "/get_supermarkets_close", "/add_fetched_items", "/transcribe", "/change_password"]
        targeted_endpoint = request.url.path
        if targeted_endpoint in auth_needed_endpoints:
            auth_token = request.headers.get("Authorization", "none")
            print(auth_token)
            validRequest = verify_token(auth_token)
            if not validRequest:
                return JSONResponse(
                    status_code=401,
                    content={
                        "detail": f"Incorrect username or password",
                        "path": str(request.url.path),
                    },
                )

        response = await call_next(request)
        duration = time.time() - start_time

        # Log slow requests
        if duration > 1.0:
            logger.warning(
                f"Slow request: {request.method} {request.url.path} "
                f"- {duration:.2f}s - Status: {response.status_code}"
            )

        return response

    except Exception as e:
        duration = time.time() - start_time
        logger.error(
            f"Request failed: {request.method} {request.url.path} "
            f"- {duration:.2f}s - Error: {e}"
        )
        logger.error(traceback.format_exc())

        return JSONResponse(
            status_code=500,
            content={
                "detail": f"Internal server error: {str(e)}",
                "path": str(request.url.path),
            },
        )


@app.post("/token", tags=["core", "auth"])
async def login_for_access_token(
    request: Request,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> Token:
    async with request.app.state.pool.acquire() as con:
        user = await authenticate_user(con, form_data.username, form_data.password)
        ACCESS_TOKEN_EXPIRE_SECONDS = int(os.getenv("ACCESS_TOKEN_EXPIRE_SECONDS") or 30 * 60)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        access_token = create_access_token(
            data={"sub": user.username},
            expires_delta=timedelta(seconds=ACCESS_TOKEN_EXPIRE_SECONDS),
        )
        return Token(access_token=access_token, token_type="bearer")


@app.post("/change_password", tags=["core", "auth"])
async def change_password(
    request: Request,
    body: ChangePasswordRequest,
):
    if len(body.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    if body.current_password == body.new_password:
        raise HTTPException(status_code=400, detail="New password must be different from current password")

    auth_token = request.headers.get("Authorization", "none")
    username = verify_token(auth_token)
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


# ============================================================================
# NEW RESTful API ENDPOINTS (Optimized & Consistent Naming)
# ============================================================================

@app.get("/fetch_items", tags=["fetch", "core", "db usage"])
async def fetch_items(
    request: Request,
    only_wish_list: Optional[str] = Query(None),
    sortOrder: Optional[str] = Query(None),
    skip: Optional[int] = Query(None),
    limit: Optional[int] = Query(None),
    searchQuery: Optional[str] = Query(None),
):
    """
    Fetch items with optional filters

    @deprecated Use /api/items instead for better performance and cleaner response
    This endpoint is maintained for backwards compatibility only.
    """
    auth_token = request.headers.get("Authorization", "none")
    username = verify_token(auth_token)

    sortOrder = sortOrder.lower() if sortOrder else sortOrder
    logger.info(
        f"""fetch_items: only_wish_list={only_wish_list},
            sortOrder={sortOrder}, searchQuery={searchQuery}, skip={skip}, limit={limit}"""
    )

    try:
        if skip and skip < 0:
            skip = 0

        if limit and limit < 0:
            limit = 0

        query, params = build_fetch_query(
            username,
            only_wish_list,
            sortOrder=sortOrder,
            skip=skip,
            limit=limit,
            searchQuery=searchQuery
        )

        rows = await request.app.state.db.fetch_with_retry(query, *params)

        items = [
            {
                "ean": row["ean"],
                "text": row["item_name"],
                "shortened_name": row["shortened_name"],
                "count": row["count"],
                "perish_dates": [reformatTimeStamp(ts) for ts in row["perish_dates"]],
                "imageUrl": row["image_url"] or "https://boldo.ddns.net/none_available.webp",
                "tags": row["class"],
            }
            for row in rows
        ]
        accumulated_count = sum(item["count"] for item in items)

        return {"items": items, "distinct_items": len(items), "accumulated_count": accumulated_count}

    except Exception as e:
        logger.error(f"fetch_items error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to fetch items")


def classify_shortened_names(
    shortened_names: list[str],
    categories: list[str] = [],
    useBatch: bool = True,
) -> list[str]:
    if useBatch:
        mapping: dict[str, str] | None = classifier.shortenTextBatch(
            shortened_names, categories
        )
        if mapping:
            return list(mapping.values())
        else:
            return shortened_names

    else:
        return [classifier.shortenText(name, categories) for name in shortened_names]


@app.get("/get_supermarkets_close", tags=["experimental"])
async def get_supermarkets_close(
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    radius_meters: int = Query(2000, ge=100, le=50000),
    chains: Optional[list[str]] = Query(None),
) -> dict:
    """
    Get supermarkets near given coordinates using Overpass API.
    """

    # Validate required parameters
    if lat is None:
        raise HTTPException(status_code=400, detail="Missing required parameter: lat")
    if lon is None:
        raise HTTPException(status_code=400, detail="Missing required parameter: lon")

    # Validate coordinate ranges
    if not -90 <= lat <= 90:
        raise HTTPException(
            status_code=400, detail="Latitude must be between -90 and 90"
        )
    if not -180 <= lon <= 180:
        raise HTTPException(
            status_code=400, detail="Longitude must be between -180 and 180"
        )

    print(f"Searching: lat={lat}, lon={lon}, radius={radius_meters}m, chains={chains}")

    overpass_url = "https://overpass.private.coffee/api/interpreter"

    # Build chain filter if provided
    chain_filter = ""
    if chains:
        chain_pattern = "|".join(chains)
        chain_filter = f'["name"~"^({chain_pattern})$",i]'

    # Overpass QL query
    overpass_query = f"""
    [out:json][timeout:25];
    (
      node["shop"="supermarket"]{chain_filter}(around:{radius_meters},{lat},{lon});
      way["shop"="supermarket"]{chain_filter}(around:{radius_meters},{lat},{lon});
    );
    out center tags;
    """

    try:
        response = requests.get(
            overpass_url,
            params={"data": overpass_query},
            timeout=30,
            headers={"User-Agent": "SupermarketFinder/1.0"},
        )
        response.raise_for_status()
        data = response.json()

        results = []
        for element in data.get("elements", []):
            # Get coordinates
            if element["type"] == "node":
                element_lat = element["lat"]
                element_lon = element["lon"]
            else:  # way
                element_lat = element.get("center", {}).get("lat")
                element_lon = element.get("center", {}).get("lon")

            # Extract useful info
            tags = element.get("tags", {})
            results.append(
                {
                    "name": tags.get("name", "Unknown"),
                    "lat": element_lat,
                    "lon": element_lon,
                    "street": tags.get("addr:street"),
                    "housenumber": tags.get("addr:housenumber"),
                    "postcode": tags.get("addr:postcode"),
                    "city": tags.get("addr:city"),
                    "opening_hours": tags.get("opening_hours"),
                    "phone": tags.get("phone"),
                    "website": tags.get("website"),
                    "brand": tags.get("brand"),
                }
            )

        return {"results": results, "count": len(results)}

    except requests.exceptions.Timeout:
        raise HTTPException(
            status_code=504, detail="Overpass API request timed out. Please try again."
        )
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail="Too many requests to Overpass API. Please wait and try again.",
            )
        raise HTTPException(status_code=502, detail=f"Overpass API error: {str(e)}")
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data: {e}")
        raise HTTPException(
            status_code=502, detail="Error communicating with Overpass API"
        )

@app.post("/add_fetched_items", tags=["infra"])
async def addFetchedItems(request: Request, body: AddFetchedItems):
    try:
        for item in body.items:
            for (date, count) in zip(item.perish_dates, item.per_date_count):
                await addItemToInventory(
                    request.app.state.http_client,
                    request.app.state.pool,
                    username=item.username,         # was: int(item.userId)
                    ean=item.ean,
                    item_name=item.item_name,
                    count=count,
                    is_wish=validate_wish_list(item.isWished),
                    date=parser.parse(date),
                )

        return {"message": f"Synced {len(body.items)} items", "status": "success"}

    except Exception as e:
        return {"status": "error", "message": f"failed with this error: {e}", "code": "500"}


@lru_cache(maxsize=1000)
def getCategories(ean: str, delay: float = 0.5):
    try:
        time.sleep(delay)
        res = requests.get(
            f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=categories_tags"
        )
        json = res.json()
        categories: dict[str, str] = json["product"].get("categories_tags", [])

        if not categories or len(categories) == 0:
            logger.warning(f"failed to get the categories for ean: {ean} ")

        return categories

    except Exception as e:
        logger.warning(
            f"failed to do the category fetching for this ean: {ean}. error: {e} "
        )

async def mapItemToWishDaemon(pool: asyncpg.Pool, waitingTime: float = 60.0):
    from transcript_classify.wishMapperClass import WishMapper

    try:
        mapper = WishMapper()
        while True:
            await asyncio.sleep(waitingTime)
            logger.info(
                f"started mapItemToWishDaemon function after waiting time: {waitingTime}"
            )
            async with pool.acquire() as con:
                rows_items = await con.fetch(
                    """
                        SELECT DISTINCT items.item_name
                        FROM items
                        JOIN item_classification classification ON classification.item_id = items.item_id
                        JOIN inventory inv ON inv.item_id = items.item_id
                        WHERE (inv.is_wish IS NULL OR inv.is_wish = 'false')
                        AND (classification.mapped_wishes IS NULL OR classification.mapped_wishes = 'none')
                    """
                )

                rows_wished = await con.fetch(
                    """
                        select distinct(items.item_name) as item_name from inventory inv
                        join items on items.item_id = inv.item_id
                        where inv.is_wish = 'true'
                    """
                )

                item_names = [row["item_name"] for row in rows_items]
                wished_items = [row["item_name"] for row in rows_wished]

            if not item_names:
                logger.info("mapItemToWishDaemon: nothing to map")
                continue  # was: return — would exit the daemon after first empty pass

            try:
                updated_count = 0
                async with pool.acquire() as con:
                    for item_name in item_names:
                        mapped: str = mapper.mapWishItem(item_name, wished_items)
                        await con.execute(
                            """
                                UPDATE item_classification
                                SET mapped_wishes = CASE
                                    WHEN mapped_wishes IS NULL THEN $1
                                    ELSE mapped_wishes || ',' || $1
                                END
                                FROM items
                                WHERE items.item_id = item_classification.item_id
                                AND items.item_name = $2
                            """,
                            mapped,
                            item_name,
                        )
                        updated_count += 1
            finally:
                pass

            logger.info(
                f"Updated {updated_count} item names out of {len(wished_items)} wish items, with length(item_names) = {len(item_names)}"
            )
            # removed: return {"done": True, "updated": updated_count}

    except Exception as e:
        logger.error(f"Daemon for item wish mapping failed: {e}")
        logger.error(traceback.format_exc())


async def rescanImageUrlsDaemon(pool: asyncpg.Pool, waitingTime: float = 35.0):
    try:
        while True:
            await asyncio.sleep(waitingTime)
            logger.info("rescanning for empty and deprecated image urls")
            await rescanImageUrls(pool)
    except Exception as error:
        logger.error(f"the rescanImageUrlsDaemon daemon failed with this error: {error} ")


async def shortenItemNamesDaemon(
    pool: asyncpg.Pool, useBatch: bool = True, waitingTime: float = 30.0
):
    try:
        while True:
            async with pool.acquire() as con:
                await rescanCategoriesProcess(con)
                rows = await con.fetch(
                    """
                        select distinct(items.item_name) as item_name,
                        classification.categories_off as categories, classification.class as class
                        from items left join item_classification classification on
                        classification.item_id = items.item_id
                        where classification.class is null
                    """
                )

                original_names = [
                    row["item_name"]
                    for row in rows
                    if row["class"] == "" and row["item_name"].lower() not in ("", "none")
                ]

                updated_count = 0
                if original_names:
                    shortened_deterministic = [
                        shortenWithTable(name) for name in original_names
                    ]

                    categories = [row["categories"] for row in rows]

                    shortened_list = classify_shortened_names(
                        shortened_deterministic, categories, useBatch=useBatch
                    )

                    for item_name, shortened_name in zip(original_names, shortened_list):
                        if shortened_name:
                            await con.execute(
                                """
                                UPDATE items
                                SET shortened_name = $1
                                where item_name = $2
                                """,
                                str(shortened_name),
                                str(item_name),
                            )
                            updated_count += 1

            logger.info(
                f"Updated {updated_count} item names out of {len(original_names)} empty entries"
            )
            await asyncio.sleep(waitingTime)
            # removed: return {...} — would have exited after one iteration

    except Exception as e:
        logger.error(f"Daemon for item name shortening failed: {e}")
        logger.error(traceback.format_exc())


async def assignTagsTask(pool: asyncpg.Pool, waitingTime: float = 30.0):
    updatedCount = 0
    while True:
        try:
            await asyncio.sleep(waitingTime)
            logger.info(
                f"the assignTagsTask daemon got started after waiting time: {waitingTime}"
            )
            async with pool.acquire() as con:
                rows = await con.fetch(
                    """
                        select inv.item_id as ean, items.item_name, classification.class as class, classification.categories_off as categories
                        from inventory inv join items on items.item_id = inv.item_id
                        join item_classification classification on classification.item_id = inv.item_id
                        where classification.class is null
                    """
                )
                itemsToProcess: list[dict[str, str]] = []

                for row in rows:
                    if row["ean"] not in ["-1", "0", "1"]:
                        itemsToProcess.append(
                            {
                                "item_name": row["item_name"],
                                "shortened_name": row["class"],
                                "categories": row["categories"],
                            }
                        )

                if not itemsToProcess:
                    continue

                logger.info(
                    f"processing {len(itemsToProcess)} items for tag assignment"
                )

                tagMapping: dict[
                    str, dict[str, str]
                ] = await classifier.tagAssignmentBatch(items=itemsToProcess)

                logger.warning(f"this is the tagmapping: {tagMapping}")
                for item in itemsToProcess:
                    try:
                        itemName = item["item_name"]
                        tagsDict: dict[str, str] = tagMapping[itemName]
                        # New format: just the category ID (e.g., "milk", "bread")
                        tags: str = tagsDict["base"]

                        await con.execute(
                            """
                                UPDATE item_classification
                                SET class = $1
                                FROM items
                                WHERE items.item_name = $2
                                AND item_classification.item_id = items.item_id
                            """,
                            str(tags),
                            str(itemName),
                        )
                        updatedCount += 1

                    except Exception as e:
                        raise Exception(
                            f"got an error for this tags dict: {tagsDict} with this being the error: {e}"
                        )

        except Exception as e:
            logger.error(f"Daemon for tag assignment failed: {e}")
            logger.error(traceback.format_exc())

async def shorten_item_name_task(pool: asyncpg.Pool, item_name: str):
    """Background task to shorten a specific item name"""
    try:
        async with pool.acquire() as con:
            row = await con.fetchrow(
                """
                SELECT ic.class, ic.categories_off as categories
                FROM items i
                LEFT JOIN item_classification ic ON ic.item_id = i.item_id
                WHERE i.item_name = $1 AND (ic.class IS NULL OR ic.class = '')
                LIMIT 1
                """,
                item_name,
            )
            if row and row["categories"] is not None and item_name.lower() not in ["", "none"]:
                stripped_name = shortenWithTable(item_name)
                shortened_name = classifier.shortenText(
                    stripped_name, row["categories"]
                )
                if shortened_name:
                    await con.execute(
                        """
                        UPDATE items SET shortened_name = $1 WHERE item_name = $2
                        """,
                        shortened_name,
                        item_name,
                    )
                    logger.info(
                        f"Background task: Shortened item name '{item_name}' to '{shortened_name}'"
                    )
                else:
                    await con.execute(
                        """
                        UPDATE items SET shortened_name = $1 WHERE item_name = $2
                        """,
                        "none",
                        item_name,
                    )
                    logger.info(
                        f"Background task: Shortened item name '{item_name}' to 'none'"
                    )

    except Exception as e:
        logger.error(f"Background task error shortening item name: {e}")


def processTagRuleBased(tag: str) -> str:
    tagList = tag.split(",")
    # structure is [base, flavour, form]
    base, flavour, _ = tagList[0], tagList[1], tagList[2]
    if not base:
        processedName = "none"
    else:
        if flavour:
            processedName = f"{base} {flavour}"
        else:
            processedName = base

    return processedName


def processTagAiBatch(tagList: list[str]) -> dict[str, str]:
    if len(tagList) == 0 or not tagList:
        return {}

    tagToNameMapping = classifier.tagToNameBatch(tagList)
    if tagToNameMapping:
        return tagToNameMapping
    else:
        return {tag: tag for tag in tagList}

async def taggingToNameBatch(
    pool: asyncpg.Pool, tagsList: list[str], useAi: bool = True
) -> dict[str, str] | None:
    try:
        if len(tagsList) == 0:
            return {}

        for idx, tag in enumerate(tagsList):
            tagsLexikographic = ",".join(sorted(tag.split(",")))
            tagsList[idx] = tagsLexikographic

        tagNameMapping: dict[str, str] = {}
        async with pool.acquire() as con:
            rows = await con.fetch(
                "select tags, inferred_name from tagging_to_name where tags = ANY($1::text[])",
                tagsList,                           # was: tuple(tagsList) inside IN ($1)
            )

            for row in rows:
                tags = row["tags"]
                inferred_name = row["inferred_name"]

                tagsList.remove(tags)
                tagNameMapping[tags] = inferred_name

            if not useAi:
                for tag in tagsList:
                    processedName = processTagRuleBased(tag)

                    row = await con.fetchrow(
                        "select tags from tagging_to_name where tags = $1", tag
                    )
                    if row:
                        await con.execute(
                            "update tagging_to_name set inferred_name = $1 where tags = $2",
                            processedName,
                            tag,
                        )
                    else:
                        await con.execute(
                            "insert into tagging_to_name (inferred_name, tags) values ($1, $2) ",
                            processedName,
                            tag,
                        )

                    tagNameMapping[tag] = processedName
            else:
                differentialMapping = processTagAiBatch(tagsList)
                for tag in differentialMapping.keys():
                    tagNameMapping[tag] = differentialMapping[tag]
                    await con.execute(
                        "insert into tagging_to_name (inferred_name, tags) values ($1, $2) ",
                        differentialMapping[tag],
                        tag,
                    )

        return tagNameMapping
    except Exception as e:
        logger.error(
            f"the taggingToNameBatch function failed with tagsList = {tagsList}, useAi = {useAi} and this error {e}"
        )

async def rescanCategoriesProcess(con: asyncpg.pool.PoolConnectionProxy):
    try:
        rows = await con.fetch("""select distinct(inv.item_id) as ean, classification.categories_off as categories
                                    from inventory inv left join item_classification classification on
                                    classification.item_id = inv.item_id""")
        eansToMod = []

        for row in rows:
            if row["categories"] is None and row["ean"] not in "-1":
                eansToMod.append(row["ean"])

        updated_count = 0
        for ean in eansToMod:
            categories = getCategories(ean)
            if categories:
                await con.execute(                  # was: con.fetch
                    "UPDATE item_classification SET categories_off = $1 WHERE item_id = $2",
                    str(categories),
                    ean,
                )
                updated_count += 1
            else:
                await con.execute(                  # was: con.fetch
                    "UPDATE item_classification SET categories_off = $1 WHERE item_id = $2", "[]", ean
                )

        logger.info(
            f"Updated {updated_count} category entries out of {len(eansToMod)} empty entries"
        )

        return {
            "done": True,
            "updated": updated_count,
            "total_empty": len(eansToMod),
            "eansUpdated": str(eansToMod),
        }

    except Exception as e:
        logger.error(
            f"Failed while rescanning categories in rescanCategoriesProcess: {e}"
        )
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}


async def resetDeprecatedImageUrls(con: asyncpg.pool.PoolConnectionProxy, deprecationDays: int = 30) -> list[str]:

    items_to_update = await con.fetch(
        """
        select item_id as ean from items
        where (last_checked_at < now() - $1 * interval '1 day' or image_url is null)
        and not item_id = '-1'
        """,
        deprecationDays
    )

    await con.execute(
        """
        update items set last_checked_at = now()
        where (last_checked_at < now() - $1 * interval '1 day' or image_url is null)
        and not item_id = '-1'
        """,
        deprecationDays
    )

    return [item["ean"] for item in items_to_update]


async def rescanImageUrls(pool: asyncpg.Pool, delay: float = 1):
    try:
        updated_count = 0
        async with httpx.AsyncClient(
            headers={"User-Agent": "grocery-list-app/1.0"},
            timeout=httpx.Timeout(5.0),
        ) as client:
            async with pool.acquire() as con:
                eansToMod = await resetDeprecatedImageUrls(con, deprecationDays=30)
                if not eansToMod:
                    logger.info("rescanImageUrls: nothing to update")
                    return {"done": True, "updated": 0, "total_empty": 0}

                for ean in eansToMod:
                    image_url = await getImageUrlAsync(client, ean, delay=delay)
                    if image_url:
                        await con.execute(
                            "update items set image_url = $1 where item_id = $2",
                            image_url, ean,
                        )
                        updated_count += 1

        logger.info(f"Updated {updated_count} image URLs out of {len(eansToMod)} entries")
        return {"done": True, "updated": updated_count, "total_empty": len(eansToMod)}

    except Exception as e:
        logger.error(f"Failed while rescanning image URLs: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}


@app.post("/add_ean_to_list/", tags=["core", "add"])
async def add_ean_to_list(
    request: Request, body: AddEanRequest
):
    if not body.ean and not body.item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")

    item_name = body.item_name
    count_delta = int(body.count) if body.count else 1
    is_wish = validate_wish_list(body.wish_list)

    print(f"body in add ean to list: {body}")

    auth_token = request.headers.get("Authorization", "none")
    username = verify_token(auth_token)
    logger.info(f"for auth_token: {auth_token} we get this username: {username}")
    try:
        if count_delta == 0:
            return {
                "ean": body.ean,
                "product_name": item_name,
                "done": True,
                "known_to_db": "could not check",
                "operation": "nothing",
            }
        else:
            res = await addItemToInventory(request.app.state.http_client, request.app.state.pool,
                               ean=body.ean, username=username, item_name=item_name,
                               count=count_delta, is_wish=is_wish)
            logger.info(f"we have gotten this result: {res}")
            return {
                "ean": body.ean,
                "product_name": item_name,
                "done": True,
                "known_to_db": True,
                "operation": res.get("operation", "unknown"),
            }
    except Exception as e:
        logger.error(f"failed with this error: {e}")
        raise HTTPException(status_code=500, detail="Failed to add item")


@app.post("/transcribe", tags=["phase out"])
async def transcribe_endpoint(
    request: Request,
    ListTypesInput: Optional[str] = Query(None),
    file: UploadFile = File(...),
):
    """Transcribe audio and classify item"""
    if not Config.ENABLE_WHISPER_MODEL_CLOUD and not Config.ENABLE_WHISPER_MODEL_LOCAL:
        raise HTTPException(status_code=503, detail="Transcription not enabled")

    file_path = None
    listType = None
    print(f"ListTypesInput: {ListTypesInput}")
    try:
        if ListTypesInput == ListTypes.wishList.value:
            listType = ListTypes.wishList
        elif ListTypesInput == ListTypes.itemList.value:
            listType = ListTypes.itemList
        else:
            listType = ListTypes.itemList  # let the listType stay with the default
            logger.info(f"stood with the default list type value: {listType}")

        # Read and validate file
        contents = await file.read()
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file received")

        logger.info(f"Transcribe: {file.filename}, {len(contents)} bytes")

        # Save file
        os.makedirs("uploads", exist_ok=True)
        file_path = f"uploads/audio_{int(time.time() * 1000)}.webm"
        with open(file_path, "wb") as f:
            f.write(contents)

        # Transcribe
        transcribed_text = transcribe(
            file_path=file_path,
        )
        logger.info(f"Transcription: {transcribed_text[:100]}...")

        # Get classes for classification
        async with request.app.state.pool.acquire() as con:
            if listType == ListTypes.itemList:
                rows = await con.fetch(
                    "SELECT DISTINCT item_name FROM item_list WHERE iswished = 'false'"
                )
            elif listType == ListTypes.wishList:
                rows = await con.fetch(
                    "SELECT DISTINCT item_name FROM item_list WHERE iswished = 'true'"
                )
            classes = [r["item_name"] for r in rows]

        # Classify
        classified = classifier.classify(input_text=transcribed_text, classes=classes)
        class_retrieved = classified["category"]
        action_retrieved = classified["action"]

        # Update item count
        logger.info(f"action retrieved: {action_retrieved}")
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                if action_retrieved == "remove":
                    numberToAdd = "- 1"
                elif action_retrieved == "add":
                    numberToAdd: str = "+ 1"
                else:
                    numberToAdd: str = "0"

                if numberToAdd != "0":
                    # only go after those in the item list
                    if listType == ListTypes.itemList:
                        await con.execute(
                            f"UPDATE item_list SET count = count {numberToAdd} WHERE item_name = $1",
                            class_retrieved,
                        )
                        await con.execute("DELETE FROM item_list WHERE count <= 0")
                    # only go after those in the wish list
                    elif listType == ListTypes.wishList:
                        await con.execute(
                            f"UPDATE item_list SET count = count {numberToAdd} WHERE item_name = $1 and iswished = 'true' ",
                            class_retrieved,
                        )
                        await con.execute("DELETE FROM item_list WHERE count <= 0")
                    else:
                        logger.info("executing nothing")
                else:
                    logger.info("couldnt retrieve action out of this => do nothing")

        response = {
            "transcribed_text": transcribed_text,
            "class_retrieved": class_retrieved,
            "size": len(contents),
            "filename": os.path.basename(file_path),
            "numberToAdd": numberToAdd,
            "action_retrieved": action_retrieved,
        }

        logger.info(f"returning: {response}")
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass

@app.get("/health", tags=["infra"])
async def health_check(request: Request):
    """Health check endpoint for monitoring"""
    status = {"status": "healthy", "timestamp": dt.datetime.now().isoformat()}

    # Check database connection
    try:
        await request.app.state.db.fetchval_with_retry("SELECT 1")
        status["database"] = "connected"
    except Exception:
        status["database"] = "disconnected"
        status["status"] = "degraded"

    # Check optional services
    status["whisper"] = (
        "enabled"
        if (Config.ENABLE_WHISPER_MODEL_LOCAL or Config.ENABLE_WHISPER_MODEL_CLOUD)
        else "disabled"
    )
    net = getattr(request.app.state, "net", None)   # was: request.app.state.net
    status["ml_model"] = "loaded" if net else "disabled"

    return status


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================
if __name__ == "__main__":

    cpuCount = os.cpu_count()
    workerNumber = 1
    if cpuCount:
        workerNumber = min(cpuCount, 4)
    logger.info(f"using {workerNumber} workers")

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=3030,
        reload=False,
        log_level="info",
        workers=workerNumber,
        loop="uvloop",
        http="httptools",
        access_log=True,
    )