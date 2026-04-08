import json
import os
from pathlib import Path
import sys
import traceback
import aiofiles
from dateutil import parser
import uuid

from fastapi.security import OAuth2PasswordRequestForm
from Config import Config
from utils.db.schema import DATABASE_SCHEMA, DATABASE_TABLES
from supermarkets.classifier import CatalogueClassifier

import httpx
from utils.db.dbManager import DatabaseManager
from utils.api_helpers import (
    addItemToInventory,
    buildWishPantryLists,
    classifyCatalogue,
    convertAddressToCoordinates,
    craftWishItemLists,
    generateManualItemId,
    getImageUrlAsync,
    getUsernameFromReq,
    getIdFromUsername,
    isAddSupermarketBodyValid,
    isCatolgueBodyValid,
    obtainSupermarketId,
    reformatTimeStamp,
    sanitizeDeprecationDays,
    validate_wish_list,
    handleUsernameNoneAfterAuth,
    addRecipeToDb,
    hashListState,
)
from supermarkets.query_supermarkets import handleSupermarketsDbLoad
from utils.query_builder import build_fetch_query
from utils.text_processing import shortenWithTable
from enum import Enum
import requests
from dotenv import load_dotenv

os.environ["KMP_DUPLICATE_LIB_OK"] = "True"

import datetime as dt
from datetime import datetime

from typing import Annotated, Optional
from contextlib import asynccontextmanager
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
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

from utils.types import (
    AddCatalogueRequest,
    AddEanRequest,
    AddFetchedItems,
    AddRecipe,
    AddSupermarketRequest,
    ChangePasswordRequest,
    Ingredient,
    Recipe,
)
from utils.password_helper import (
    Token,
    authenticate_user,
    create_access_token,
    get_password_hash,
    get_user,
    verify_password,
    verify_token,
)
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(".env")
key = os.getenv("GROQ_API_KEY")
if not key:
    raise Exception("GROQ_API_KEY not set or empty")


# Validate conflicting settings
if Config.ENABLE_WHISPER_MODEL_CLOUD and Config.ENABLE_WHISPER_MODEL_LOCAL:
    raise ValueError(
        "Cannot enable both WHISPER_MODEL_LOCAL and WHISPER_MODEL_CLOUD simultaneously"
    )

# Conditional imports
if Config.ENABLE_WHISPER_MODEL_CLOUD:
    from transcript_classify.transcript import transcribe
    from transcript_classify import classifier


# add the path above /server to the working dir
sys.path.append(str(Path(__file__).resolve().parent.parent))


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


async def ensure_schema(pool: asyncpg.Pool) -> None:
    try:
        async with pool.acquire() as con:
            for command in DATABASE_SCHEMA:
                try:
                    await con.execute(command)
                    logger.info("executing init for table ")
                except Exception as error:
                    logger.error(
                        f"failed for table creation for this command {command} with this error: {error}"
                    )

    except Exception as error:
        logger.error(f"failed in ensure schema with this error: {error}")


async def init_database(pool: asyncpg.Pool):
    """
    Initialize database with schema-driven approach.

    This function:
    1. Ensures all tables match the defined schema (creates/updates as needed)
    2. Will load supermarket location data into the db
    3. Is idempotent and safe to run multiple times
    """
    try:
        logger.info("Starting database initialization...")

        # Step 1: Ensure schema compliance (always runs)
        await ensure_schema(pool)
        logger.info("✓ Schema compliance verified")

        # Step 2: Load supermarket data to db
        logger.info("loading in the geo supermarkets data")
        await handleSupermarketsDbLoad(pool, logger, "supermarkets")

        # Step 3: add sink label to items (for the wish mapper daemon)
        logger.info(
            f"adding sink label {Config.SINK_LABEL_WISH_MAPPING} to the items table"
        )
        async with pool.acquire() as con:
            sink = Config.SINK_LABEL_WISH_MAPPING
            sinkId = generateManualItemId(itemName=sink)
            sinkExists = await con.fetch(
                "SELECT EXISTS(SELECT 1 FROM items WHERE item_id = $1)", sinkId
            )
            if not sinkExists:
                await con.execute(
                    "insert into items (item_id, item_name, last_checked_at ) values ($1, $2, now())",
                    sinkId,
                    Config.SINK_LABEL_WISH_MAPPING,
                )
            print()

        # Step 4: Final status report
        logger.info("finished loading the geo supermarket data")
        async with pool.acquire() as con:
            tables_info = []
            for table_name in DATABASE_TABLES:
                count = await con.fetchval(f"SELECT COUNT(*) FROM {table_name}") or 0
                tables_info.append(f"{table_name}({count} rows)")

            logger.info(
                f"✓ Database initialized successfully: {', '.join(tables_info)}"
            )

    except Exception as e:
        logger.exception(f"Critical database initialization error: {e}")
        raise


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

        # init admin user list
        adminList = os.getenv("ADMIN_USERNAMES") or ""
        adminList = adminList.split(",")
        app.state.adminList = [admin.lower() for admin in adminList]

        app.state.catalogueClassifier = CatalogueClassifier()

        http_client = httpx.AsyncClient(
            headers={"User-Agent": "grocery-list-app/1.0"}, timeout=httpx.Timeout(5.0)
        )
        app.state.http_client = http_client

        # Initialize database schema
        await init_database(app.state.pool)

        # Start background daemon tasks (run once at startup)
        daemon_tasks.append(asyncio.create_task(classificationDaemon(app.state.pool)))
        logger.info("✓ Started classification daemon")

        daemon_tasks.append(asyncio.create_task(rescanImageUrlsDaemon(app.state.pool)))
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
        auth_needed_endpoints = [
            # "/fetch_items",
            "/add_ean_to_list/",
            "/add_fetched_items",
            "/transcribe",
            "/change_password",
            "/get_supermarkets_close",
            "/add_new_market",
            "/post_catalogue",
            "/get_catalogue_offers",
        ]

        admin_only_endpoints = ["/post_catalogue"]

        targeted_endpoint = request.url.path
        if targeted_endpoint in auth_needed_endpoints:
            auth_token = request.headers.get("Authorization", "none")
            validUsername = verify_token(auth_token)
            if not validUsername:
                logger.info(
                    "Auth rejected: method=%s path=%s query=%s auth_present=%s ua=%s referer=%s origin=%s",
                    request.method,
                    request.url.path,
                    request.url.query,
                    auth_token != "none",
                    request.headers.get("user-agent", ""),
                    request.headers.get("referer", ""),
                    request.headers.get("origin", ""),
                )
                return JSONResponse(
                    status_code=401,
                    content={
                        "detail": "Incorrect username or password",
                        "path": str(request.url.path),
                    },
                )

            adminList = request.app.state.adminList
            if len(adminList) > 0:
                if (
                    targeted_endpoint in admin_only_endpoints
                    and validUsername not in adminList
                ):
                    logger.info(
                        "Auth rejected: method=%s path=%s query=%s auth_present=%s ua=%s referer=%s origin=%s, non-admin tried to use admin-only endpoint",
                        request.method,
                        request.url.path,
                        request.url.query,
                        auth_token != "none",
                        request.headers.get("user-agent", ""),
                        request.headers.get("referer", ""),
                        request.headers.get("origin", ""),
                    )
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": "you dont have the elevated privilges to access this endpoint",
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


@app.post("/change_password", tags=["core", "auth"])
async def change_password(
    request: Request,
    body: ChangePasswordRequest,
):
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
    username = getUsernameFromReq(request) or "benno"

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
            searchQuery=searchQuery,
        )

        rows = await request.app.state.db.fetch_with_retry(query, *params)

        items = [
            {
                "ean": row.get("ean"),
                "text": row.get("item_name"),
                "shortened_name": row.get("shortened_name"),
                "count": row.get("count"),
                "perish_dates": [
                    reformatTimeStamp(ts) for ts in row.get("perish_dates")
                ],
                "imageUrl": row.get("image_url")
                or "https://boldo.ddns.net/none_available.webp",
                "tags": row.get("class", ""),
                "mapped_items": json.loads(
                    row.get("mapped_items") or "[]"
                ),  # if you fetch for the wish list
            }
            for row in rows
        ]
        accumulated_count = sum(item["count"] for item in items)

        return {
            "items": items,
            "distinct_items": len(items),
            "accumulated_count": accumulated_count,
        }

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


@app.get("/get_catalogue_offers")
async def get_offers(
    request: Request,
    longitude: float,
    latitude: float,
    DeprecationDays: Optional[int] = None,
) -> dict:

    DeprecationDays = sanitizeDeprecationDays(DeprecationDays, default=30)

    oldestValidTs: datetime = datetime.now() - dt.timedelta(days=DeprecationDays)

    async with request.app.state.pool.acquire() as con:
        supermarketId = await obtainSupermarketId(
            con, AddCatalogueRequest(longitude=longitude, latitude=latitude)
        )
        rows = await con.fetch(
            """select
                item_name,
                shortened_name,
                added_at,
                original_price,
                offer_price,
                is_app_offer,
                weight_g,
                volume_ml
            from grocery_offers where supermarket_id = $1 and added_at >= $2""",
            supermarketId,
            oldestValidTs,
        )

        items: list[dict] = []
        for row in rows:
            items.append(
                {
                    "name": row.get("item_name"),
                    "shortened_name": row.get("shortened_name"),
                    "weight_g": row.get("weight_g"),
                    "volume_ml": row.get("volume_ml"),
                    "normal_price": row.get("original_price"),
                    "discount_price": row.get("offer_price"),
                    "is_app_offer": row.get("is_app_offer"),
                }
            )
    return {"items": items, "count": len(items)}


@app.post("/add_new_market", tags=["experimental", "db", "geo"])
async def post_market(request: Request, body: AddSupermarketRequest) -> dict:
    try:
        if not body.name or body.name.strip() == "":
            return {
                "status": "error",
                "message": "name is required",
                "code": "400",
            }

        if not isAddSupermarketBodyValid(body):
            return {
                "status": "error",
                "message": "Body requires either (latitude + longitude) or (address + city/postcode)",
                "code": "400",
            }

        resolved_lat = body.latitude
        resolved_lon = body.longitude
        resolved_address = body.address
        resolved_city = body.city
        geocode_source = "request_coordinates"

        if resolved_lat is None or resolved_lon is None:
            if not body.address or not body.city:
                return {
                    "status": "error",
                    "message": "address and city are required when coordinates are missing",
                    "code": "400",
                }

            result = convertAddressToCoordinates(body.address, body.city)
            logger.info(f"add_new_market geocode result: {result} for body: {body}")

            if result.get("status") == "error":
                return {
                    "status": "error",
                    "message": result.get("message", "Failed to geocode address"),
                    "code": result.get("code", "500"),
                }

            resolved_lat = result.get("latitude")
            resolved_lon = result.get("longitude")
            resolved_address = result.get("address") or body.address
            resolved_city = result.get("city") or body.city
            geocode_source = "photon"

        if resolved_lat is None or resolved_lon is None:
            return {
                "status": "error",
                "message": "Could not resolve market coordinates",
                "code": "500",
            }

        async with request.app.state.pool.acquire() as con:
            row = await con.fetchrow(
                """
                insert into supermarkets(name, longitude, latitude, address, chain)
                values($1, $2, $3, $4, $5)
                returning supermarket_id, name, longitude, latitude, address, chain
                """,
                body.name.strip(),
                float(resolved_lon),
                float(resolved_lat),
                resolved_address,
                body.category,
            )

        return {
            "status": "success",
            "detail": "Backend received market payload and stored it successfully",
            "message": "Supermarket added to database",
            "geocode_source": geocode_source,
            "market": dict(row) if row else None,
            "input": {
                "name": body.name,
                "address": body.address,
                "city": resolved_city,
                "category": body.category,
            },
        }

    except Exception as e:
        logger.error(f"add_new_market failed: {e}")
        logger.error(traceback.format_exc())
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


@app.post("/post_catalogue", tags=["experimental", "db", "geo"])
async def post_catlogue(
    request: Request,
    catalogue: UploadFile,
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    lat: Optional[float] = Form(None),
    lon: Optional[float] = Form(None),
    name: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    categories: Optional[str] = Form(None),
    city: Optional[str] = Form(None),
    postcode: Optional[str] = Form(None),
) -> dict:
    if latitude is not None and lat is not None and latitude != lat:
        raise HTTPException(
            status_code=400,
            detail="Provide either latitude or lat, not conflicting values",
        )
    if longitude is not None and lon is not None and longitude != lon:
        raise HTTPException(
            status_code=400,
            detail="Provide either longitude or lon, not conflicting values",
        )

    resolved_lat = latitude if latitude is not None else lat
    resolved_lon = longitude if longitude is not None else lon

    payload = {
        "latitude": resolved_lat,
        "longitude": resolved_lon,
        "name": name,
        "address": address,
        "categories": categories,
        "city": city,
        "postcode": postcode,
    }

    logger.info(f"post_catalogue payload: {payload}")

    try:
        body = AddCatalogueRequest.model_validate(payload)
    except Exception as e:
        raise HTTPException(
            status_code=422, detail=f"Invalid catalogue metadata: {e}"
        ) from e

    if not isCatolgueBodyValid(body):
        raise HTTPException(
            status_code=400,
            detail="you havent provided enough positional data for it to be mapped to a market",
        )

    if not catalogue.filename:
        raise HTTPException(status_code=400, detail="you havent uploaded a valid file")

    try:
        upload_dir = "server/supermarkets/uploads"
        os.makedirs(upload_dir, exist_ok=True)

        ALLOWED = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}

        if catalogue.content_type not in ALLOWED:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {catalogue.content_type}",
            )

        ext = ALLOWED[catalogue.content_type]
        unique_filename = (
            f"{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4()}{ext}"
        )
        file_path = os.path.join(upload_dir, unique_filename)

        contents = await catalogue.read()
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(contents)

        asyncio.create_task(
            classifyCatalogue(
                request.app.state.pool,
                request.app.state.catalogueClassifier,
                body,
                file_path,
                logger,
            )
        )
        return {
            "status": "ok",
            "code": 202,
            "detail": "catalogue accepted and queued for classification",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to process catalogue upload: {e}"
        ) from e


@app.get("/get_supermarkets_close", tags=["experimental", "db", "geo"])
async def get_supermarkets_close(
    request: Request,
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    radius_meters: int = Query(2000, ge=100, le=50000),
    chains: Optional[list[str]] = Query(None),
) -> dict:
    if lat is None:
        raise HTTPException(status_code=400, detail="Missing required parameter: lat")
    if lon is None:
        raise HTTPException(status_code=400, detail="Missing required parameter: lon")
    if not -90 <= lat <= 90:
        raise HTTPException(
            status_code=400, detail="Latitude must be between -90 and 90"
        )
    if not -180 <= lon <= 180:
        raise HTTPException(
            status_code=400, detail="Longitude must be between -180 and 180"
        )

    try:
        results = []
        async with request.app.state.pool.acquire() as con:
            rows = await con.fetch(
                """
                WITH params AS (
                    SELECT $1::float AS latitude, $2::float AS longitude, $3::float AS radius_m
                )
                SELECT s.*, (
                    6371000 * ACOS(
                        COS(RADIANS(p.latitude)) * COS(RADIANS(s.latitude)) *
                        COS(RADIANS(s.longitude) - RADIANS(p.longitude)) +
                        SIN(RADIANS(p.latitude)) * SIN(RADIANS(s.latitude))
                    )
                ) AS distance_m
                FROM supermarkets s, params p
                WHERE s.latitude BETWEEN p.latitude - (p.radius_m / 111320.0)
                                AND p.latitude + (p.radius_m / 111320.0)
                AND s.longitude BETWEEN p.longitude - (p.radius_m / (111320.0 * COS(RADIANS(p.latitude))))
                                AND p.longitude + (p.radius_m / (111320.0 * COS(RADIANS(p.latitude))))
                AND (
                    6371000 * ACOS(
                        COS(RADIANS(p.latitude)) * COS(RADIANS(s.latitude)) *
                        COS(RADIANS(s.longitude) - RADIANS(p.longitude)) +
                        SIN(RADIANS(p.latitude)) * SIN(RADIANS(s.latitude))
                    )
                ) <= p.radius_m
                ORDER BY distance_m
            """,
                lat,
                lon,
                radius_meters,
            )
        for row in rows:
            results.append(
                {
                    "name": row.get("name", "Unknown"),
                    "latitude": row.get("latitude"),
                    "longitude": row.get("longitude"),
                    "address": row.get("address"),
                    "opening_hours": row.get("opening_periods"),
                    "brand": row.get("brand"),
                }
            )

        return {"results": results, "count": len(results)}

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


@app.get("/recipes")
async def getRecipes(request: Request):
    username = getUsernameFromReq(request) or "benno"
    if not username:
        return handleUsernameNoneAfterAuth()
    async with request.app.state.pool.acquire() as con:
        userId = await getIdFromUsername(con, username)
        res = await con.fetch(
            """SELECT
                                re.recipe_id,
                                re.base_time,
                                re.default_portions,
                                re.tags,
                                re.emoji,
                                json_agg(json_build_object(
                                    'amount', ing.amount,
                                    'unit',   ing.unit,
                                    'name',   ing.name,
                                    'count',  rip.count
                                )) AS ingredients
                                FROM recipes re
                                JOIN recipe_ingredient_map rip ON rip.recipe_id = re.recipe_id
                                JOIN ingredients ing ON ing.ingredient_id = rip.ingredient_id
                                WHERE re.user_id = $1
                                GROUP BY re.recipe_id, re.base_time, re.default_portions, re.tags, re.emoji""",
            userId,
        )

        recipes = [
            Recipe(
                recipe_id=row["recipe_id"],
                base_time=row["base_time"],
                default_portions=row["default_portions"],
                tags=row["tags"],
                emoji=row["emoji"],
                ingredients=[
                    Ingredient(**ing) for ing in json.loads(row["ingredients"])
                ],
            )
            for row in res
        ]

        return {
            "recipes": [r.model_dump() for r in recipes],
            "recipe_count": len(recipes),
        }


@app.post("/recipes")
async def addRecipe(request: Request, body: AddRecipe) -> dict:
    username = getUsernameFromReq(request)
    if not username:
        return handleUsernameNoneAfterAuth()
    async with request.app.state.pool.acquire() as con:
        userId = await getIdFromUsername(con, username)
        status = await addRecipeToDb(con, userId, body)

    return status


@app.post("/add_fetched_items", tags=["infra", "db"])
async def addFetchedItems(request: Request, body: AddFetchedItems):
    username = getUsernameFromReq(request)
    try:
        for item in body.items:
            for date, count in zip(item.perish_dates, item.per_date_count):
                await addItemToInventory(
                    request.app.state.http_client,
                    request.app.state.pool,
                    username=username,
                    ean=item.ean,
                    item_name=item.item_name,
                    count=count,
                    quantity=None,
                    is_wish=validate_wish_list(item.isWished),
                    date=parser.parse(date),
                    logger=logger,
                )

        return {"message": f"Synced {len(body.items)} items", "status": "success"}

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


async def mapItemToWishDaemon(pool: asyncpg.Pool):
    try:
        from transcript_classify import classifier as classifier_module

        async with pool.acquire() as con:
            (
                item_names,
                wished_lists,
                itemIdMapping,
                hashPerItem,
            ) = await buildWishPantryLists(
                con, sinkLabel=Config.SINK_LABEL_WISH_MAPPING
            )

        if not item_names or not wished_lists:
            logger.info("mapItemToWishDaemon: nothing to map")
            return

        mapped_results: dict[str, dict] = await asyncio.to_thread(
            classifier_module.mapWishItemBatch,
            item_names,
            wished_lists,
        )

        updates = []
        items = mapped_results["items"]
        wishListToIdx: dict[str, int] = mapped_results["wish_list_to_idx"]
        idxToWishList: dict[int, str] = {v: k for k, v in wishListToIdx.items()}

        logger.warning(
            f"item id mapping: {itemIdMapping},\nitems: {items}\nidx to wish list: {idxToWishList}"
        )
        for idx, item_name in enumerate(items.keys()):
            mappedItemDict: dict = items[item_name]
            wishIdx: int = mappedItemDict["wish_list_index"]
            wishListStr: str = idxToWishList[wishIdx]
            mapped_wish = mappedItemDict["mapped_wish"]
            wish_hash, pantry_hash = hashPerItem[idx]
            updates.append(
                (
                    itemIdMapping[item_name],
                    itemIdMapping[mapped_wish],
                    wish_hash,
                    pantry_hash,
                )
            )

        logger.info(f"these are the updates: {updates}")

        if not updates:
            logger.info("mapItemToWishDaemon: no wish matches produced")
            return

        async with pool.acquire() as con:
            await con.executemany(
                """
                    INSERT INTO wish_mapping (item_id, wish_item_id, wish_list_hash, pantry_list_hash)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (item_id, wish_list_hash)
                    DO UPDATE SET wish_item_id = EXCLUDED.wish_item_id
                """,
                updates,
            )

        logger.info(
            "Updated %d item mappings out of %d candidate items using %d wished items",
            len(updates),
            len(item_names),
            len(wished_lists),
        )

    except Exception as e:
        logger.error(f"Daemon for item wish mapping failed: {e}")
        logger.error(traceback.format_exc())


async def rescanImageUrlsDaemon(pool: asyncpg.Pool, waitingTime: float = 10.0):
    try:
        while True:
            await asyncio.sleep(waitingTime)
            logger.info("rescanning for empty and deprecated image urls")
            await rescanImageUrls(pool)
    except Exception as error:
        logger.error(
            f"the rescanImageUrlsDaemon daemon failed with this error: {error} "
        )


async def classificationDaemon(pool: asyncpg.Pool, waitingTime: float = 10.0):
    while True:
        try:
            await asyncio.sleep(waitingTime)
            logger.info("classificationDaemon: starting pass")

            await rescanCategoriesProcess(pool)
            await shortenItemNamesDaemon(pool)
            await assignTagsTask(pool)
            await mapItemToWishDaemon(pool)

            logger.info("classificationDaemon: pass complete")

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"classificationDaemon failed: {e}")
            logger.error(traceback.format_exc())


async def shortenItemNamesDaemon(pool: asyncpg.Pool, useBatch: bool = True):
    try:
        # Fetch phase: acquire, query, release immediately
        async with pool.acquire() as con:
            rows = await con.fetch(
                """
                select distinct(items.item_name) as item_name,
                classification.categories_off as categories, classification.class as class
                from items left join item_classification classification on
                classification.item_id = items.item_id
                where classification.class is null
                """
            )

        # Process outside the connection
        original_names = [
            row["item_name"]
            for row in rows
            if row["class"] == ""
            and row["item_name"]
            and row["item_name"].lower() not in ("", "none")
        ]
        categories = [row["categories"] for row in rows]

        updated_count = 0
        if original_names:
            shortened_deterministic = [
                shortenWithTable(name) for name in original_names
            ]
            shortened_list = classify_shortened_names(
                shortened_deterministic, categories, useBatch=useBatch
            )

            # Write phase: reacquire only for writes
            async with pool.acquire() as con:
                for item_name, shortened_name in zip(original_names, shortened_list):
                    if shortened_name:
                        await con.execute(
                            "UPDATE items SET shortened_name = $1 WHERE item_name = $2",
                            str(shortened_name),
                            str(item_name),
                        )
                        updated_count += 1

        logger.info(
            f"Updated {updated_count} item names out of {len(original_names)} empty entries"
        )

    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(f"Daemon for item name shortening failed: {e}")
        logger.error(traceback.format_exc())


async def assignTagsTask(pool: asyncpg.Pool):
    updatedCount = 0
    try:
        async with pool.acquire() as con:
            rows = await con.fetch(
                """
                select inv.item_id as ean, items.item_name, classification.class as class,
                classification.categories_off as categories
                from inventory inv join items on items.item_id = inv.item_id
                join item_classification classification on classification.item_id = inv.item_id
                where classification.class is null
                """
            )

        itemsToProcess = [
            {
                "item_name": row["item_name"],
                "shortened_name": row["class"],
                "categories": row["categories"],
            }
            for row in rows
            if row["ean"] not in ("-1", "0", "1")
        ]

        tagMapping: dict[str, dict[str, str]] = await classifier.tagAssignmentBatch(
            items=itemsToProcess
        )

        async with pool.acquire() as con:
            for item in itemsToProcess:
                try:
                    itemName = item["item_name"]
                    tagsDict = tagMapping[itemName]
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
                    logger.error(
                        f"tag assignment failed for item {item.get('item_name')}: {tagsDict} — {e}"
                    )

    except asyncio.CancelledError:
        raise
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
            if (
                row
                and row["categories"] is not None
                and item_name.lower() not in ["", "none"]
            ):
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


async def rescanCategoriesProcess(pool: asyncpg.Pool):
    try:
        async with pool.acquire() as con:
            rows = await con.fetch("""
                SELECT DISTINCT(inv.item_id) AS ean, classification.categories_off AS categories
                FROM inventory inv
                LEFT JOIN item_classification classification ON classification.item_id = inv.item_id
            """)

        eansToMod = [
            row["ean"]
            for row in rows
            if row["categories"] is None and row["ean"] not in ("-1", "0", "1")
        ]

        if not eansToMod:
            logger.info("rescanCategoriesProcess: nothing to update")
            return {"done": True, "updated": 0, "total_empty": 0}

        results: dict[str, list] = {}
        async with httpx.AsyncClient(
            headers={"User-Agent": "grocery-list-app/1.0"},
            timeout=httpx.Timeout(5.0),
        ) as client:
            for ean in eansToMod:
                try:
                    await asyncio.sleep(0.5)
                    res = await client.get(
                        f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=categories_tags",
                        timeout=5.0,
                    )
                    data = res.json()
                    categories = data.get("product", {}).get("categories_tags", [])
                except Exception as e:
                    logger.warning(f"failed to get categories for ean {ean}: {e}")
                    categories = []

                results[ean] = categories

        updated_count = 0
        async with pool.acquire() as con:
            for ean, categories in results.items():
                await con.execute(
                    "UPDATE item_classification SET categories_off = $1 WHERE item_id = $2",
                    str(categories) if categories else "[]",
                    ean,
                )
                if categories:
                    updated_count += 1

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


async def resetDeprecatedImageUrls(
    con: asyncpg.pool.PoolConnectionProxy, deprecationDays: int = 30
) -> list[str]:

    items_to_update = await con.fetch(
        """
        select item_id as ean from items
        where (last_checked_at < now() - $1 * interval '1 day' or image_url is null)
        and not item_id = '-1'
        """,
        deprecationDays,
    )

    await con.execute(
        """
        update items set last_checked_at = now()
        where (last_checked_at < now() - $1 * interval '1 day' or image_url is null)
        and not item_id = '-1'
        """,
        deprecationDays,
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
                    image_url = await getImageUrlAsync(
                        client, ean, delay=delay, logger=logger
                    )
                    if image_url:
                        await con.execute(
                            "update items set image_url = $1 where item_id = $2",
                            image_url,
                            ean,
                        )
                        updated_count += 1

        logger.info(
            f"Updated {updated_count} image URLs out of {len(eansToMod)} entries"
        )
        return {"done": True, "updated": updated_count, "total_empty": len(eansToMod)}

    except Exception as e:
        logger.error(f"Failed while rescanning image URLs: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}


@app.post("/add_ean_to_list/", tags=["core", "add"])
async def add_ean_to_list(request: Request, body: AddEanRequest):
    incoming_ean = (body.ean or "").strip()
    ean = incoming_ean or None

    incoming_item_name = (
        (body.item_name or "").strip() if body.item_name is not None else ""
    )
    item_name = (
        None
        if incoming_item_name.lower() in {"", "none", "null", "undefined"}
        else incoming_item_name
    )

    if not ean and not item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")

    count_delta = int(body.count) if body.count is not None else 1
    is_wish = validate_wish_list(body.wish_list)

    logger.info(
        "add_ean_to_list normalized payload: raw_ean=%r raw_item_name=%r ean=%r item_name=%r count=%s wish=%s",
        body.ean,
        body.item_name,
        ean,
        item_name,
        count_delta,
        is_wish,
    )

    username = getUsernameFromReq(request)
    try:
        if count_delta == 0:
            return {
                "ean": ean,
                "product_name": item_name,
                "done": True,
                "known_to_db": "could not check",
                "mode": "ean" if ean else "manual adding",
                "operation": "nothing",
            }
        else:
            res = await addItemToInventory(
                request.app.state.http_client,
                request.app.state.pool,
                ean=ean,
                username=username,
                item_name=item_name,
                count=count_delta,
                quantity=body.quantity_data,
                is_wish=is_wish,
                logger=logger,
            )
            logger.info(f"we have gotten this result: {res}")
            return {
                "ean": res.get("ean", ean),
                "product_name": res.get("product_name", item_name),
                "done": True,
                "known_to_db": res.get("known_to_db", True),
                "mode": res.get("mode", "ean" if ean else "manual adding"),
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
    numberToAdd = "0"
    logger.info(f"ListTypesInput: {ListTypesInput}")
    try:
        if ListTypesInput == ListTypes.wishList.value:
            listType = ListTypes.wishList
        elif ListTypesInput == ListTypes.itemList.value:
            listType = ListTypes.itemList
        else:
            listType = ListTypes.itemList
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
        transcribed_text = transcribe(file_path=file_path)
        logger.info(f"Transcription: {transcribed_text[:100]}...")

        # Get classes for classification
        async with request.app.state.pool.acquire() as con:
            if listType == ListTypes.itemList:
                rows = await con.fetch(
                    """
                    SELECT DISTINCT items.item_name
                    FROM inventory inv
                    JOIN items ON items.item_id = inv.item_id
                    WHERE inv.is_wish = false
                    """
                )
            elif listType == ListTypes.wishList:
                rows = await con.fetch(
                    """
                    SELECT DISTINCT items.item_name
                    FROM inventory inv
                    JOIN items ON items.item_id = inv.item_id
                    WHERE inv.is_wish = true
                    """
                )
            classes = [r["item_name"] for r in rows]

        # Classify
        classified = classifier.classify(input_text=transcribed_text, classes=classes)
        class_retrieved = classified["category"]
        action_retrieved = classified["action"]

        logger.info(f"action retrieved: {action_retrieved}")

        # Update inventory
        if action_retrieved == "remove":
            numberToAdd = "-1"
            delta = -1
        elif action_retrieved == "add":
            numberToAdd = "+1"
            delta = 1
        else:
            numberToAdd = "0"
            delta = 0

        if delta != 0:
            username = getUsernameFromReq(request)
            await addItemToInventory(
                request.app.state.http_client,
                request.app.state.pool,
                username=username,
                ean=None,
                item_name=class_retrieved,
                count=delta,
                is_wish=(listType == ListTypes.wishList),
                quantity=None,
                logger=logger,
            )
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
    net = getattr(request.app.state, "net", None)  # was: request.app.state.net
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
        workers=1,
        loop="uvloop",
        http="httptools",
        access_log=True,
    )
