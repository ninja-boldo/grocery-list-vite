import os
import sys
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager

os.environ["KMP_DUPLICATE_LIB_OK"] = "True"

import datetime as dt
from dotenv import load_dotenv

import logging
from logging.handlers import RotatingFileHandler, QueueHandler, QueueListener
import queue
import atexit

import httpx
import asyncpg
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from Config import Config
from utils.db.schema import DATABASE_SCHEMA, DATABASE_TABLES
from utils.db.dbManager import DatabaseManager
from utils.daemons import classificationDaemon, rescanImageUrlsDaemon
from utils.api_helpers import generateManualItemId
from utils.password_helper import verify_token

from routes import auth, core, geo, meal_planning


load_dotenv(".env")

key = os.getenv("API_KEY")
if not key:
    raise Exception("API_KEY not set or empty")

sys.path.append(str(Path(__file__).resolve().parent.parent))

logger = logging.getLogger("fastapi-logger")
logger.handlers.clear()


class SafeLokiHandler:
    def __init__(self, *args, **kwargs):
        self.fallback_handler = logging.StreamHandler()
        self.fallback_handler.setLevel(logging.INFO)
        self.fallback_handler.setFormatter(
            logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        )
        self._loki_available = False

    def emit(self, record):
        self.fallback_handler.emit(record)


def setup_logging() -> tuple[QueueListener, logging.Logger]:
    log_queue = queue.Queue()
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    handlers = []

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    handlers.append(console_handler)

    if Config.ENABLE_FILE_LOGGING:
        file_handler = RotatingFileHandler(
            "server.log",
            maxBytes=Config.LOG_FILE_MAX_SIZE,
            backupCount=Config.LOG_FILE_BACKUP_COUNT,
        )
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(formatter)
        handlers.append(file_handler)

    if Config.ENABLE_LOKI_LOGGING:
        # Check Loki availability asynchronously to avoid blocking startup.
        # We defer this to a background task; for now just skip the sync check.
        try:
            loki_handler = SafeLokiHandler(
                url=f"{Config.LOKI_URL}/loki/api/v1/push",
                tags={"application": "grocery-list", "environment": "development"},
                version="1",
            )
            handlers.append(loki_handler)
            print("✓ Loki handler registered (availability not pre-checked)")
        except Exception as e:
            print(f"⚠ Loki handler setup failed: {e}")

    queue_listener = QueueListener(log_queue, *handlers, respect_handler_level=True)
    queue_handler = QueueHandler(log_queue)
    logger.addHandler(queue_handler)
    logger.setLevel(logging.INFO)
    queue_listener.start()

    print(f"✓ Logging initialized with {len(handlers)} handler(s)")
    return queue_listener, logger


queue_listener, logger = setup_logging()
atexit.register(lambda: queue_listener.stop() if queue_listener else None)


if Config.ENABLE_WHISPER_MODEL_CLOUD and Config.ENABLE_WHISPER_MODEL_LOCAL:
    raise ValueError(
        "Cannot enable both WHISPER_MODEL_LOCAL and WHISPER_MODEL_CLOUD simultaneously"
    )


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


async def ensure_schema(pool: asyncpg.Pool) -> None:
    try:
        async with pool.acquire() as con:
            for command in DATABASE_SCHEMA:
                try:
                    await con.execute(command)
                    logger.info("executing init for table")
                except Exception as error:
                    logger.error(
                        f"failed for table creation for command {command}: {error}"
                    )
    except Exception as error:
        logger.error(f"failed in ensure schema: {error}")


async def _ensure_sink_label(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as con:
        sink = Config.SINK_LABEL_WISH_MAPPING
        sinkId = generateManualItemId(itemName=sink)
        exists = await con.fetchval(
            "SELECT EXISTS(SELECT 1 FROM items WHERE item_id = $1)", sinkId
        )
        if not exists:
            await con.execute(
                "INSERT INTO items (item_id, item_name, last_checked_at) VALUES ($1, $2, now())",
                sinkId,
                sink,
            )


async def _log_table_counts(pool: asyncpg.Pool) -> None:
    """Purely diagnostic — runs fire-and-forget after startup."""
    try:
        async with pool.acquire() as con:
            tables_info = []
            for table_name in DATABASE_TABLES:
                count = await con.fetchval(f"SELECT COUNT(*) FROM {table_name}") or 0
                tables_info.append(f"{table_name}({count} rows)")
            logger.info(f"✓ Database initialized: {', '.join(tables_info)}")
    except Exception as e:
        logger.warning(f"Table count diagnostic failed: {e}")


async def init_database(pool: asyncpg.Pool) -> None:
    logger.info("Starting database initialization...")

    # Schema must be applied first.
    await ensure_schema(pool)
    logger.info("✓ Schema compliance verified")

    # Supermarket geo load and sink label insert are independent — run together.
    from supermarkets.query_supermarkets import handleSupermarketsDbLoad

    logger.info("loading geo supermarkets data + sink label in parallel")
    await asyncio.gather(
        handleSupermarketsDbLoad(pool, logger, "supermarkets"),
        _ensure_sink_label(pool),
    )
    logger.info("finished loading geo supermarket data")

    # Table counts are diagnostic only — fire and forget so they don't delay startup.
    asyncio.create_task(_log_table_counts(pool))


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    daemon_tasks = []
    http_client: httpx.AsyncClient | None = None

    try:
        # --- DB pool ---
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

        app.state.db = DatabaseManager(app.state.pool, logger)

        adminList = os.getenv("ADMIN_USERNAMES") or ""
        app.state.adminList = [admin.lower() for admin in adminList.split(",")]

        # --- Shared HTTP client ---
        http_client = httpx.AsyncClient(
            headers={"User-Agent": "grocery-list-app/1.0"},
            timeout=httpx.Timeout(5.0),
        )
        app.state.http_client = http_client

        # --- parallelized DB init and classifier load ---

        loop = asyncio.get_event_loop()

        from supermarkets.classifier import CatalogueClassifier

        _, classifier = await asyncio.gather(
            init_database(app.state.pool),
            loop.run_in_executor(None, CatalogueClassifier),
        )
        app.state.catalogueClassifier = classifier
        logger.info("✓ CatalogueClassifier loaded")

        # --- daemons ---
        daemon_tasks.append(
            asyncio.create_task(classificationDaemon(app.state.pool, logger))
        )
        logger.info("✓ Started classification daemon")

        daemon_tasks.append(asyncio.create_task(rescanImageUrlsDaemon(app.state.pool)))
        logger.info("✓ Started image url rescanning daemon")

        yield

    finally:
        for idx, daemon in enumerate(daemon_tasks):
            daemon.cancel()
            try:
                await daemon
            except asyncio.CancelledError:
                logger.info(f"{idx + 1}. Daemon task cancelled")

        if http_client and not http_client.is_closed:
            await http_client.aclose()
            logger.info("async http client closed")

        if hasattr(app.state, "pool") and app.state.pool:
            await app.state.pool.close()
            logger.info("Database pool closed")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(lifespan=lifespan, debug=False)

if Config.ENABLE_PROMETHEUS:
    Instrumentator().instrument(app).expose(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(auth.router)
app.include_router(core.router)
app.include_router(geo.router)
app.include_router(meal_planning.router)


@app.middleware("http")
async def request_middleware(request: Request, call_next):
    import time

    start_time = time.time()
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
    auth_needed_prefixes = ["/recipes/"]
    admin_only_endpoints = ["/post_catalogue"]

    targeted_endpoint = request.url.path
    if targeted_endpoint in auth_needed_endpoints or any(
        targeted_endpoint.startswith(prefix) for prefix in auth_needed_prefixes
    ):
        auth_token = request.headers.get("Authorization", "none")
        validUsername = verify_token(auth_token)
        if validUsername is None:
            logger.info(
                f"Auth rejected: method={request.method} path={request.url.path} query={request.url.query}"
            )
            return JSONResponse(
                status_code=401,
                content={
                    "detail": "Incorrect username or password",
                    "path": str(request.url.path),
                },
            )

        adminList = request.app.state.adminList
        if (
            adminList
            and targeted_endpoint in admin_only_endpoints
            and validUsername not in adminList
        ):
            logger.info(
                f"Auth rejected (not admin): method={request.method} path={request.url.path}"
            )
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "you dont have elevated privileges",
                    "path": str(request.url.path),
                },
            )

    response = await call_next(request)
    duration = time.time() - start_time
    if duration > 1.0:
        logger.warning(
            f"Slow request: {request.method} {request.url.path} - {duration:.2f}s - Status: {response.status_code}"
        )
    return response


@app.get("/health", tags=["infra"])
async def health_check(request: Request):
    status_resp = {"status": "healthy", "timestamp": dt.datetime.now().isoformat()}
    try:
        await request.app.state.db.fetchval_with_retry("SELECT 1")
        status_resp["database"] = "connected"
    except Exception:
        status_resp["database"] = "disconnected"
        status_resp["status"] = "degraded"

    status_resp["whisper"] = (
        "enabled"
        if (Config.ENABLE_WHISPER_MODEL_LOCAL or Config.ENABLE_WHISPER_MODEL_CLOUD)
        else "disabled"
    )
    net = getattr(request.app.state, "net", None)
    status_resp["ml_model"] = "loaded" if net else "disabled"
    return status_resp


if __name__ == "__main__":
    cpuCount = os.cpu_count()
    workerNumber = min(cpuCount, 4) if cpuCount else 1
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
