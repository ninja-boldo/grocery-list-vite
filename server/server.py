import json
import os
from pathlib import Path
import sys
import traceback
import aiofiles
from dateutil import parser
import uuid

from fastapi.security import OAuth2PasswordRequestForm
from pydantic import TypeAdapter, ValidationError
from Config import Config
from utils.daemons import (
    classificationDaemon,
    rescanImageUrlsDaemon,
    resetDeprecatedImageUrls,
)
from utils.db.schema import DATABASE_SCHEMA, DATABASE_TABLES
from supermarkets.classifier import CatalogueClassifier

import httpx
from utils.db.dbManager import DatabaseManager
from utils.api_helpers import (
    addItemToInventory,
    cleanupStaleWishMappings,
    getCurrentPantryListUserPydantic,
    getCurrentWishHashForUser,
    classifyCatalogue,
    convertAddressToCoordinates,
    deleteMealInWeek,
    deleteRecipeById,
    generateManualItemId,
    getImageUrlAsync,
    getPlannerSettings,
    getSpecificMealInWeek,
    getUsernameFromReq,
    getIdFromUsername,
    getWeekPlanForUser,
    getWeekSettingsForUser,
    isAddSupermarketBodyValid,
    isCatolgueBodyValid,
    obtainSupermarketId,
    reformatTimeStamp,
    replaceMealByTimestamp,
    replacePlannerSettings,
    replaceWeekPlanForUser,
    replaceWeekSettingsForUser,
    sanitizeDeprecationDays,
    validate_wish_list,
    handleUsernameNoneAfterAuth,
    addRecipeToDb,
)
from supermarkets.query_supermarkets import handleSupermarketsDbLoad
from utils.query_builder import build_fetch_query
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
    Form,
    Query,
    Request,
    UploadFile,
    HTTPException,
    status,
)
import uvicorn

from fastapi.responses import JSONResponse

from prometheus_fastapi_instrumentator import Instrumentator

import time
import logging
from logging_loki import LokiHandler

import asyncpg
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
    AddWeekPlan,
    ChangePasswordRequest,
    Ingredient,
    InternalClassification,
    Item,
    MealSlot,
    PlannerSettings,
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
            "/fetch_items",
            "/add_ean_to_list/",
            "/add_fetched_items",
            "/transcribe",
            "/change_password",
            "/get_supermarkets_close",
            "/add_new_market",
            "/post_catalogue",
            "/get_catalogue_offers",
            "/recipes",
            "/week_plan",
            "/planner_settings",
            "/week_plan/replace_meal",
        ]

        auth_needed_prefixes = [
            "/recipes/",
        ]

        admin_only_endpoints = ["/post_catalogue"]

        targeted_endpoint = request.url.path
        if targeted_endpoint in auth_needed_endpoints or any(
            targeted_endpoint.startswith(prefix) for prefix in auth_needed_prefixes
        ):
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
    """
    Authenticate user and return access token

    Endpoint for user login to obtain an access token for API authentication.
    Expects username and password form data.
    """
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
    """
    Change user's password

    Validates current password, ensures new password meets length requirements,
    and updates the password in the database.
    Requires authentication token in request.
    """
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

    Endpoint for retrieving items from inventory with various filtering and sorting options.

    Parameters:
    - only_wish_list: Filter to only fetch wish list items if "true"
    - sortOrder: Sort order for results (e.g., "name_asc", "name_desc", "date_asc")
    - skip: Number of items to skip for pagination
    - limit: Maximum number of items to return
    - searchQuery: Text to search in item names

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

        wish_hash: Optional[str] = None

        if only_wish_list == "true":
            async with request.app.state.db.pool.acquire() as con:
                user_id = await getIdFromUsername(con, username)
                if user_id:
                    await cleanupStaleWishMappings(con, user_id)
                    wish_hash = await getCurrentWishHashForUser(con, user_id)

        query, params = build_fetch_query(
            username,
            only_wish_list,
            sortOrder=sortOrder,
            skip=skip,
            limit=limit,
            searchQuery=searchQuery,
            wish_hash=wish_hash,
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


@app.get("/get_catalogue_offers", tags=["catalogue", "offers", "geo"])
async def get_offers(
    request: Request,
    longitude: float,
    latitude: float,
    DeprecationDays: Optional[int] = None,
) -> dict:
    """
    Get current catalogue offers for a specific location

    Retrieves grocery offers from stores near the given coordinates.
    Filters offers by deprecation days to return only current promotions.

    Parameters:
    - longitude: Longitude coordinate of the location
    - latitude: Latitude coordinate of the location
    - DeprecationDays: Number of days to consider offers as valid (default: 30)

    Returns:
    - Dictionary with items, count, and offer details
    """
    try:
        DeprecationDays = sanitizeDeprecationDays(DeprecationDays, default=30)

        oldestValidTs: datetime = datetime.now() - dt.timedelta(days=DeprecationDays)

        async with request.app.state.pool.acquire() as con:
            supermarketId = await obtainSupermarketId(
                con, AddCatalogueRequest(longitude=longitude, latitude=latitude)
            )
            if not isinstance(supermarketId, int):
                raise ValueError(
                    f"the corresponding supermarket id mapping failed with this res: {supermarketId}"
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
    except Exception as e:
        logger.error(f"fetch_items error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to fetch items")


@app.post("/add_new_market", tags=["experimental", "db", "geo"])
async def post_market(request: Request, body: AddSupermarketRequest) -> dict:
    """
    Add a new supermarket to the database

    Creates a new supermarket entry with geographic location data.
    Accepts either direct coordinates or an address for geocoding.

    Body Parameters:
    - name: Name of the supermarket store
    - latitude: Latitude coordinate (optional if address provided)
    - longitude: Longitude coordinate (optional if address provided)
    - address: Street address for geocoding (optional)
    - city: City for geocoding (required if address provided)
    - category: Supermarket chain/category

    Returns:
    - Status success/error, with details about the operation
    """
    try:
        if not body.name or body.name.strip() == "":
            return {
                "status": "error",
                "message": "name is required",
                "code": status.HTTP_422_UNPROCESSABLE_CONTENT,
            }

        if not isAddSupermarketBodyValid(body):
            return {
                "status": "error",
                "message": "Body requires either (latitude + longitude) or (address + city/postcode)",
                "code": status.HTTP_422_UNPROCESSABLE_CONTENT,
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
                    "code": status.HTTP_422_UNPROCESSABLE_CONTENT,
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
    """
    Upload and process a supermarket catalogue PDF/image for offer extraction

    Endpoint for uploading catalogue files which are then processed in the background
    to extract product offers and match them with items in the system.

    Form Data Parameters:
    - catalogue: PDF or image file containing the catalogue
    - latitude/lat: Geographic latitude of the supermarket
    - longitude/lon: Geographic longitude of the supermarket
    - name: Name of the supermarket
    - address: Address of the supermarket (for geocoding if coords not provided)
    - categories: Supermarket chain or categories
    - city: City (for geocoding)
    - postcode: Postcode (optional)

    Returns:
    - Status response indicating acceptance and background processing
    """
    if latitude is not None and lat is not None and latitude != lat:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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
    """
    Get nearby supermarkets based on geographic location

    Returns supermarkets within a specified radius of given coordinates.
    Supports filtering by supermarket chain names.

    Query Parameters:
    - lat: Latitude coordinate (required)
    - lon: Longitude coordinate (required)
    - radius_meters: Search radius in meters (default: 2000, min: 100, max: 50000)
    - chains: List of supermarket chain names to filter by (optional)

    Returns:
    - Dictionary with supermarkets array and count
    - Each supermarket includes name, coordinates, address, and brand

    Note: Validates latitude (-90 to 90) and longitude (-180 to 180) ranges
    """
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


@app.get("/recipes", tags=["cooking", "recipes", "user data"])
async def getRecipes(request: Request):
    """
    Get all recipes for the authenticated user

    Retrieves a list of all recipes saved by the authenticated user.
    Each recipe includes ingredients with amounts, units, and names.

    Requires authentication token in request header.

    Returns:
    - recipes: Array of recipe objects with ID, base time, portions, tags, emoji, and ingredients
    - recipe_count: Total number of recipes returned
    """
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


@app.post("/recipes", tags=["cooking", "recipes", "add data"])
async def addRecipe(request: Request, body: AddRecipe) -> dict:
    """
    Add a new recipe to the user's recipe collection

    Creates a new recipe entry in the database with ingredients, preparation steps,
    and metadata. Returns the status of the operation.

    Requires authentication token in request header.

    Body Parameters (AddRecipe model):
    - base_time: Preparation time in minutes
    - default_portions: Default serving size
    - tags: Array of recipe tags/categories
    - emoji: Emoji representing the recipe
    - ingredients: Array of ingredient objects with amount, unit, name
    - steps: Array of preparation step strings (optional)

    Returns:
    - message: Status message
    - status: Success/error status
    """
    try:
        username = getUsernameFromReq(request)
        if not username:
            return handleUsernameNoneAfterAuth()
        async with request.app.state.pool.acquire() as con:
            userId = await getIdFromUsername(con, username)  # type: ignore
            state = await addRecipeToDb(con, userId, body)

        return state

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}\nwith this traceback: {traceback.format_exception(e)}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@app.post("/add_fetched_items", tags=["infra", "db", "sync"])
async def addFetchedItems(request: Request, body: AddFetchedItems):
    """
    Add items from external sources to inventory

    Syncs items from external sources (e.g., UpcItemDb API) into the user's
    inventory/pantry. Each item can have multiple perish dates with corresponding counts.

    Requires authentication token in request header.

    Body Parameters (AddFetchedItems model):
    - items: Array of items to add
      - ean: EAN code of the item
      - item_name: Name of the item
      - perish_dates: Array of date strings when items expire
      - per_date_count: Array of counts for each perish date
      - isWished: Boolean indicating if this is a wish list item

    Returns:
    - message: Success/error message
    - status: Success/error status
    - code: HTTP status code
    """
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
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@app.delete("/recipes/{recipe_id}", tags=["cooking", "recipes", "delete data"])
async def deleteRecipeByIdEndpoint(request: Request, recipe_id: int):
    """
    Delete a specific recipe by ID

    Removes a recipe from the user's collection based on recipe ID.

    Requires authentication token in request header.

    Path Parameters:
    - recipe_id: ID of the recipe to delete

    Returns:
    - message: Status message with user ID
    - status: Success/error status
    """
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)  # type: ignore
            await deleteRecipeById(con, recipe_id)

        return {
            "message": f"Successfully deleted recipe, for user {uid}",
            "status": "success",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


@app.get("/week_plan", tags=["meal planning", "get data"])
async def getSpecificMealFromWeek(request: Request, day: str, day_time: str):
    """
    Get a specific meal slot from the week planner

    Retrieves a meal entry for a specific day and time slot in the user's weekly planner.

    Requires authentication token in request header.

    Query Parameters:
    - day: Day of the week (e.g., "Monday", "Tuesday")
    - day_time: Time slot (e.g., "morning", "lunch", "dinner")

    Returns:
    - message: Status message with user ID
    - meal_slot: Details of the meal entry
    - status: Success/error status
    """
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)  # type: ignore
            meal = await getSpecificMealInWeek(con, day, day_time, uid)  #

        return {
            "message": f"Successfully retrieved meal, for user {uid}",
            "meal_slot": meal,
            "status": "success",
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


@app.get("/planner_settings", tags=["meal planning", "settings", "get data"])
async def getPlannerSettingsEndpoint(request: Request):
    """
    Get the user's planner settings

    Retrieves user-specific settings for the meal planner system, including
    portion sizes and other configuration options.

    Requires authentication token in request header.

    Returns:
    - message: Status message with user ID
    - status: Success/error status
    - planner_settings: PlannerSettings object with user's configuration
    - code: HTTP status code
    """
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)  # type: ignore
            settings: PlannerSettings = await getPlannerSettings(con, uid)

        return {
            "message": f"Successfully retrieved planner settings, for user {uid}",
            "status": "success",
            "planner_settings": settings,
            "code": status.HTTP_200_OK,
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@app.put("/planner_settings", tags=["meal planning", "settings", "update data"])
async def putPlannerSettingsEndpoint(request: Request, body: PlannerSettings) -> dict:
    """
    Replace or update the user's planner settings

    Updates the user's meal planner configuration with the provided settings.

    Requires authentication token in request header.

    Body Parameters (PlannerSettings model):
    - channel_data: Platform-specific configuration
    - defaultPortion: Default portion size setting
    - recipe_prog_constraint: Recipe progression constraints
    - wochentage: Array of enabled days for meal planning

    Returns:
    - message: Status message with user ID
    - status: Success/error status
    - code: HTTP status code
    """
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)  # type: ignore
            await replacePlannerSettings(con, uid, body)

        return {
            "message": f"Successfully replaced planner settings, for user {uid}",
            "status": "success",
            "code": status.HTTP_200_OK,
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@app.get(
    "/classify_items_against_pantry", tags=["inventory", "classification", "get data"]
)
async def classifyItemsAgainstPantryEndpoint(
    request: Request, itemsWished: str = Query(...)
) -> JSONResponse:
    """
    Classifies a list of wished items against the current pantry of the authenticated user.

    For each pantry item, determines whether any of the wished items can be mapped to it.
    The classification is performed synchronously in a thread to avoid blocking the event loop.

    Args:
        request (Request): The FastAPI request object. Must carry valid authentication
                           for username extraction and provides access to the DB connection pool.
        itemsWished (str): A JSON-encoded list of items the user wishes to acquire,
                           passed as a URL query parameter. Each item must conform to
                           the `Item` schema, including a nested `QuantityInfo` object.

    Returns:
        JSONResponse: On success (HTTP 200):
            {
                "message": str,       # e.g. "Success for user 42"
                "status": "success",
                "mapping": list[dict] # Serialized list of InternalClassification objects
            }

    Raises:
        HTTPException 400: If `itemsWished` is not valid JSON or fails Item schema validation.
        HTTPException 401: If the username cannot be extracted from the request (auth failure).
        HTTPException 500: If the classification or any unexpected error occurs.

    Notes:
        - The pantry is fetched fresh on every call; no caching is applied.
        - `QuantityInfo` fields default to None if omitted, but the `quantity` key itself
          must be present in each item or Pydantic will raise a ValidationError (400).

    Example:
        Request:
            curl -G "http://localhost:8000/classify" \\
              -H "Authorization: Bearer <token>" \\
              --data-urlencode 'itemsWished=[
                {
                  "item_name": "Milk",
                  "item_id": "abc123",
                  "count": 2,
                  "quantity": {"product_quantity": 1000, "product_quantity_unit": "ml"},
                  "info": "3.5% fat"
                },
                {
                  "item_name": "Eggs",
                  "item_id": "def456",
                  "count": 12,
                  "quantity": {"product_quantity": null, "product_quantity_unit": null},
                  "info": ""
                }
              ]'

        Response (200):
            {
                "message": "Success for user 7",
                "status": "success",
                "mapping": [
                    {
                        "pantryItem": {
                            "item_name": "Milk", "item_id": "xyz789", "count": 1,
                            "quantity": {"product_quantity": 500, "product_quantity_unit": "ml"},
                            "info": ""
                        },
                        "mappedWishItem": {
                            "item_name": "Milk", "item_id": "abc123", "count": 2,
                            "quantity": {"product_quantity": 1000, "product_quantity_unit": "ml"},
                            "info": "3.5% fat"
                        },
                        "foundMappingWish": true
                    },
                    {
                        "pantryItem": {
                            "item_name": "Butter", "item_id": "uvw321", "count": 1,
                            "quantity": {"product_quantity": 250, "product_quantity_unit": "g"},
                            "info": ""
                        },
                        "mappedWishItem": null,
                        "foundMappingWish": false
                    }
                ]
            }
    """
    # --- Input parsing & validation ---
    try:
        items: list[Item] = TypeAdapter(list[Item]).validate_python(
            json.loads(itemsWished)
        )
    except (json.JSONDecodeError, ValidationError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid itemsWished payload: {e}",
        )

    # --- Auth ---
    try:
        username = getUsernameFromReq(request)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {e}",
        )

    # --- DB + classification ---
    try:
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)  # type: ignore
            pantry: list[Item] = await getCurrentPantryListUserPydantic(con, uid)

        mapping: list[InternalClassification] = await asyncio.to_thread(
            classifier.classifyWishAgainstPantry, items, pantry
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Classification failed: {e}",
        )

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "message": f"Success for user {uid}",
            "status": "success",
            "mapping": [m.model_dump() for m in mapping],
        },
    )


@app.delete("/week_plan", tags=["meal planning", "delete data"])
async def deleteMealSlot(request: Request, body: MealSlot) -> dict:
    """
    Delete a meal slot from the week planner

    Removes a meal entry from the user's weekly planner based on the provided
    meal slot (day and time).

    Requires authentication token in request header.

    Body Parameters (MealSlot model):
    - day: Day of the week (e.g., "Monday")
    - day_time: Time slot (e.g., "morning")
    - recipe_id: Optional ID of the recipe to remove

    Returns:
    - message: Status message with user ID
    - status: Success/error status
    - code: HTTP status code
    """
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)  # type: ignore
            await deleteMealInWeek(con, uid, body)

        return {
            "message": f"Successfully retrieved meal, for user {uid}",
            "status": "success",
            "code": status.HTTP_200_OK,
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@app.post("/week_plan/replace_meal", tags=["meal planning", "update data"])
async def replaceMeal(request: Request, body: MealSlot):
    """
    Replace a meal in the weekly planner

    Replaces an existing meal entry in the user's weekly planner with new meal details.
    Updates the planner entry identified by day and day_time with new recipe information.

    Requires authentication token in request header.

    Body Parameters (MealSlot model):
    - day: Day of the week (e.g., "Monday")
    - day_time: Time slot (e.g., "lunch")
    - recipe_id: ID of the new recipe to place in this slot
    - timestamp: Timestamp identifier for the meal slot

    Returns:
    - message: Status message with day, time, and user ID
    - status: Success/error status
    """
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)  # type: ignore
            await replaceMealByTimestamp(con, uid, body)

        return {
            "message": f"Successfully replaced the meal slot for {body.day} for {body.day_time}, for user {uid}",
            "status": "success",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@app.post("/week_plan", tags=["meal planning", "update data"])
async def postWeekPlan(request: Request, body: AddWeekPlan) -> dict:
    """
    Set or replace the entire week's meal plan and settings

    Updates the user's weekly meal planner with new meal assignments for all days,
    and replaces any week-specific settings (like portion sizes).

    Requires authentication token in request header.

    Body Parameters (AddWeekPlan model):
    - week: Array of MealSlot objects representing all meals for the week
    - DaySettings: User's planner settings for this week

    Returns:
    - message: Status message with user ID
    - status: Success/error status
    - code: HTTP status code (201 for created)
    """
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)  # type: ignore
            await replaceWeekPlanForUser(con, body.week, uid)
            await replaceWeekSettingsForUser(con, body.DaySettings, uid)

        return {
            "message": f"Successfully replaced the week's settings and meal slots for user {uid}",
            "status": "success",
            "code": status.HTTP_201_CREATED,
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@app.get("/week_plan", tags=["meal planning", "get data"])
async def getWeekPlan(request: Request):
    """
    Get the complete week planner with meals and settings

    Retrieves the entire meal planner for the authenticated user, including:
    - All meal slots for the week
    - Week-specific settings (portion sizes, constraints)

    Requires authentication token in request header.

    Returns:
    - week_plan: Serialized weekly meal plan data
    - week_settings: User's planner settings
    - code: HTTP status code (200 for success)
    """
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)  # type: ignore
            weekPlan = await getWeekPlanForUser(con, uid)
            weekSettings = await getWeekSettingsForUser(con, uid)

        return {
            "week_plan": weekPlan.model_dump_json(),
            "week_settings": weekSettings,
            "code": status.HTTP_200_OK,
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@app.get("/recipes/{recipe_id}", tags=["cooking", "recipes", "get data"])
async def getRecipeById(request: Request, recipe_id: int):
    """
    Get a specific recipe by ID

    Retrieves a single recipe from the database based on recipe ID.

    Path Parameters:
    - recipe_id: Recipe ID to retrieve

    Returns:
    - recipe_id: The requested recipe ID
    - base_time: Preparation time in minutes
    - default_portions: Default serving size
    - emoji: Emoji representing the recipe
    - tags: Array of recipe tags/categories
    - steps: Array of preparation step strings

    Errors:
    - Returns 404 if recipe not found or not accessible to user
    """
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            if username:
                uid = await getIdFromUsername(con, username)
            else:
                uid = -1
            res = await con.fetchrow(
                """select recipe_id, base_time, default_portions, emoji, tags, steps
                                  from recipes where recipe_id = $1 and user_id = $2""",
                recipe_id,
                uid,
            )
            if res is not None:
                return {
                    "recipe_id": res.get("recipe_id", None),
                    "base_time": res.get("base_time", None),
                    "default_portions": res.get("default_portions", None),
                    "emoji": res.get("emoji", None),
                    "tags": res.get("tags", None),
                    "steps": res.get("steps", None),
                }
            else:
                return {
                    "status": "error",
                    "code": status.HTTP_404_NOT_FOUND,
                    "detail": f"there is no recipe with id {recipe_id} in the inventory accessible to you",
                }

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


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


@app.post("/add_ean_to_list/", tags=["core", "inventory", "add data"])
async def add_ean_to_list(request: Request, body: AddEanRequest):
    """
    Add an item to the user's inventory by EAN or manual entry

    Adds an item to the user's inventory/pantry either by scanning an EAN barcode
    or by manually entering the item name. Supports specifying quantity and setting
    whether the item is a wish list item.

    Requires authentication token in request header.

    Body Parameters (AddEanRequest model):
    - ean: EAN barcode of the product (optional if item_name provided)
    - item_name: Name of the item to add (optional if ean provided)
    - count: Quantity of the item to add (default: 1)
    - quantity_data: Additional quantity information (optional)
    - wish_list: Boolean indicating if this should be added to wish list (optional)

    Returns:
    - ean: Normalized EAN code that was processed
    - product_name: Normalized product name that was processed
    - done: Operation success status
    - known_to_db: Whether the item was already in database (True if looked up)
    - mode: Operation mode ("ean" or "manual adding")
    - operation: Action performed (e.g., "added", "increment", "appended")
    """
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
