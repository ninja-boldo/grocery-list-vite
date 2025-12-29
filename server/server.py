import os
from pathlib import Path
import shlex
import traceback
import urllib.parse

from enum import Enum
import httpx
import requests
from dotenv import load_dotenv
os.environ['KMP_DUPLICATE_LIB_OK'] = 'True'

import datetime
import json
import shutil
from typing import Optional, Union, Any
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, Query, Request, UploadFile, HTTPException
import uvicorn

from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel


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
    ENABLE_ML_MODEL = False
    ENABLE_WHISPER_MODEL_LOCAL = False
    ENABLE_WHISPER_MODEL_CLOUD = True
    ENABLE_LOKI_LOGGING = True
    ENABLE_PROMETHEUS = True
    ENABLE_FILE_LOGGING = True
    
    # Database settings
    DB_POOL_MIN_SIZE = 1
    DB_POOL_MAX_SIZE = 5
    DB_COMMAND_TIMEOUT = 30
    DB_RETRY_ATTEMPTS = 3
    DB_RETRY_DELAY = 1.0
    
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
        if os.getenv('RUNNING_IN_CONTAINER'):
            return "postgresql://postgres:postgres@postgres-db:5432/maindb"
        return "postgresql://postgres:postgres@127.0.0.1:5432/maindb"
    
    @classmethod
    def get_csv_path(cls) -> str:
        if os.getenv('RUNNING_IN_CONTAINER'):
            return "/app/openfoodfacts.csv"
        return "/Users/bennetjollenbeck/Desktop/programming/web/react/family_projects/grocery-list2/server/openfoodfacts.csv"

# Validate conflicting settings
if Config.ENABLE_WHISPER_MODEL_CLOUD and Config.ENABLE_WHISPER_MODEL_LOCAL:
    raise ValueError("Cannot enable both WHISPER_MODEL_LOCAL and WHISPER_MODEL_CLOUD simultaneously")

# Conditional imports
if Config.ENABLE_WHISPER_MODEL_LOCAL or Config.ENABLE_WHISPER_MODEL_CLOUD:
    from transcription.transcript import init_whisper, transcribe
    from transcription import classifier

if Config.ENABLE_ML_MODEL:
    try:
        import torch # type: ignore
        import food_classifier.main as food_classifier
        device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    except Exception as e:
        raise Exception("you have to install the ml dependencies (here: torch)")

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
            logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
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
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    handlers = []
    
    # Console handler (always enabled)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    handlers.append(console_handler)
    
    # File handler (conditional)
    if Config.ENABLE_FILE_LOGGING:
        file_handler = RotatingFileHandler(
            'server.log',
            maxBytes=Config.LOG_FILE_MAX_SIZE,
            backupCount=Config.LOG_FILE_BACKUP_COUNT
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

# ============================================================================
# DATABASE UTILITIES
# ============================================================================
class DatabaseManager:
    """Centralized database operations with retry logic and self-healing"""
    
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
    
    async def execute_with_retry(
        self,
        query: str,
        *args,
        retries: int = Config.DB_RETRY_ATTEMPTS,
        delay: float = Config.DB_RETRY_DELAY
    ) -> Any:
        """Execute query with automatic retry on transient failures"""
        last_error = None
        
        for attempt in range(retries):
            try:
                async with self.pool.acquire() as con:
                    return await con.execute(query, *args)
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError) as e:
                last_error = e
                logger.warning(f"DB connection error (attempt {attempt + 1}/{retries}): {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(delay * (attempt + 1))
            except Exception as e:
                raise e
        
        raise last_error
    
    async def fetch_with_retry(
        self,
        query: str,
        *args,
        retries: int = Config.DB_RETRY_ATTEMPTS
    ) -> list:
        """Fetch rows with automatic retry"""
        last_error = None
        
        for attempt in range(retries):
            try:
                async with self.pool.acquire() as con:
                    return await con.fetch(query, *args)
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError) as e:
                last_error = e
                logger.warning(f"DB fetch error (attempt {attempt + 1}/{retries}): {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(Config.DB_RETRY_DELAY * (attempt + 1))
            except Exception as e:
                raise e
        
        raise last_error
    
    async def fetchrow_with_retry(self, query: str, *args) -> Optional[asyncpg.Record]:
        """Fetch single row with retry"""
        for attempt in range(Config.DB_RETRY_ATTEMPTS):
            try:
                async with self.pool.acquire() as con:
                    return await con.fetchrow(query, *args)
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError) as e:
                logger.warning(f"DB fetchrow error (attempt {attempt + 1}): {e}")
                if attempt < Config.DB_RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(Config.DB_RETRY_DELAY * (attempt + 1))
        return None
    
    async def fetchval_with_retry(self, query: str, *args) -> Any:
        """Fetch single value with retry"""
        for attempt in range(Config.DB_RETRY_ATTEMPTS):
            try:
                async with self.pool.acquire() as con:
                    return await con.fetchval(query, *args)
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError) as e:
                logger.warning(f"DB fetchval error (attempt {attempt + 1}): {e}")
                if attempt < Config.DB_RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(Config.DB_RETRY_DELAY * (attempt + 1))
        return None


def parse_db_url(db_url: str) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str], dict]:
    """Parse database URL into components"""
    p = urllib.parse.urlparse(db_url)
    user = urllib.parse.unquote(p.username) if p.username else None
    password = urllib.parse.unquote(p.password) if p.password else None
    host = p.hostname
    port = str(p.port) if p.port else None
    dbname = p.path.lstrip("/") if p.path else None
    env = dict(os.environ)
    if password:
        env["PGPASSWORD"] = password
    return user, host, port, dbname, env


async def run_psql_command(cmd_args: list[str], env: Optional[dict] = None) -> tuple[int, str, str]:
    """Execute psql command asynchronously"""
    proc = await asyncio.create_subprocess_exec(
        *cmd_args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    out, err = await proc.communicate()
    return proc.returncode, out.decode(errors="ignore"), err.decode(errors="ignore")


def get_script_path(level: int = 0) -> str:
    """Get script directory path, optionally going up levels"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if level < 0:
        parts = script_dir.split(os.sep)
        parts = parts[:(len(parts) + level)]
        script_dir = os.sep.join(parts) or os.sep
    return script_dir


async def init_database(pool: asyncpg.Pool, dump_path: str = "maindb.sql"):
    """Initialize database schema with self-healing capabilities"""
    dump_path = os.environ.get("PG_DUMP", dump_path)
    csv_path = Config.get_csv_path()
    
    dump_path_variants = [
        f"/app/{dump_path}",
        f"/server/{dump_path}",
        f"{get_script_path(0)}/{dump_path}",
        f"{get_script_path(-1)}/{dump_path}",
        f"{get_script_path(-2)}/{dump_path}",
    ]
    
    user, host, port, dbname, env = parse_db_url(Config.get_database_url())
    
    try:
        async with pool.acquire() as con:
            # Create tables with proper schema
            await con.execute("""
                CREATE TABLE IF NOT EXISTS food (
                    code TEXT,
                    product_name TEXT,
                    quantity TEXT,
                    packaging TEXT,
                    brands_en TEXT,
                    categories TEXT,
                    ingredients_text TEXT,
                    energy_kcal_100g TEXT
                );
            """)
            
            await con.execute("""
                CREATE TABLE IF NOT EXISTS item_list (
                    id SERIAL PRIMARY KEY,
                    ean TEXT,
                    item_name TEXT,
                    subgroups TEXT DEFAULT '',
                    class TEXT DEFAULT '',
                    count INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    timestamps JSONB DEFAULT '[]'::jsonb,
                    iswished TEXT DEFAULT 'false'
                );
            """)
            
            # Self-healing: Add missing columns
            columns_to_add = [
                ("timestamps", "JSONB DEFAULT '[]'::jsonb"),
                ("iswished", "TEXT DEFAULT 'false'"),
            ]
            for col_name, col_def in columns_to_add:
                try:
                    await con.execute(
                        f"ALTER TABLE item_list ADD COLUMN IF NOT EXISTS {col_name} {col_def};"
                    )
                except Exception as e:
                    logger.debug(f"Column {col_name} may already exist: {e}")
            
            # Create indexes for performance
            indexes = [
                ("idx_item_list_subgroups", "item_list(subgroups)"),
                ("idx_item_list_class", "item_list(class)"),
                ("idx_item_list_ean", "item_list(ean)"),
                ("idx_item_list_item_name", "item_list(item_name)"),
                ("idx_item_list_iswished", "item_list(iswished)"),
                ("idx_food_code", "food(code)"),
                ("idx_food_product_name", "food(product_name)"),
            ]
            for idx_name, idx_target in indexes:
                try:
                    await con.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {idx_target};")
                except Exception as e:
                    logger.debug(f"Index {idx_name} issue: {e}")
            
            # Check food table status
            food_count = await con.fetchval("SELECT COUNT(*) FROM food;") or 0
            logger.info(f"Food table row count: {food_count}")
        
        # Attempt restore from dump if food table is empty
        if food_count == 0:
            for variant in dump_path_variants:
                if os.path.exists(variant):
                    logger.info(f"Restoring from dump: {variant}")
                    cmd = ["psql", "-U", user, "-d", dbname, "-f", variant]
                    if host:
                        cmd[1:1] = ["-h", host]
                    if port:
                        cmd[1:1] = ["-p", port]
                    rc, out, err = await run_psql_command(cmd, env)
                    if rc == 0:
                        logger.info("Dump restore successful")
                        break
                    else:
                        logger.warning(f"Dump restore failed: {err}")
            
            # Fallback to CSV if still empty
            async with pool.acquire() as con:
                food_count = await con.fetchval("SELECT COUNT(*) FROM food;") or 0
            
            if food_count == 0 and os.path.exists(csv_path):
                logger.info(f"Loading from CSV: {csv_path}")
                copy_cmd = (
                    r"\copy food(code,product_name,quantity,packaging,brands_en,"
                    r"categories,ingredients_text,energy_kcal_100g) "
                    f"FROM {shlex.quote(csv_path)} WITH (FORMAT csv, HEADER true)"
                )
                cmd = ["psql", "-U", user, "-d", dbname, "-c", copy_cmd]
                if host:
                    cmd[1:1] = ["-h", host]
                if port:
                    cmd[1:1] = ["-p", port]
                rc, out, err = await run_psql_command(cmd, env)
                if rc == 0:
                    logger.info("CSV load successful")
                else:
                    logger.error(f"CSV load failed: {err}")
        
        # Final status check
        async with pool.acquire() as con:
            final_count = await con.fetchval("SELECT COUNT(*) FROM food;") or 0
            tables = await con.fetch(
                "SELECT tablename FROM pg_tables WHERE schemaname='public';"
            )
            logger.info(f"Database initialized. Food rows: {final_count}, Tables: {[t['tablename'] for t in tables]}")
            
    except Exception as e:
        logger.exception(f"Database initialization failed: {e}")
        raise

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================
@lru_cache(maxsize=Config.LRU_CACHE_SIZE)
def get_distinct_query(field: str) -> str:
    """Cached query builder for distinct field values"""
    return f"SELECT DISTINCT {field} FROM item_list WHERE {field} != '' AND {field} IS NOT NULL ORDER BY {field}"


def convert_timestamps_to_dates(timestamps_json: str) -> str:
    """Convert ISO timestamps to date strings"""
    try:
        arr = json.loads(timestamps_json or '[]')
        dates = [datetime.datetime.fromisoformat(t).date().isoformat() for t in arr]
        return json.dumps(dates)
    except (json.JSONDecodeError, ValueError):
        return '[]'


def safe_int(value: Any, default: int = 1) -> int:
    """Safely convert value to int"""
    try:
        return int(value) if value is not None else default
    except (ValueError, TypeError):
        return default


def sanitize_string(value: Optional[str], default: str = "") -> str:
    """Sanitize string input"""
    return (value or default).strip()


def validate_wish_list(value: Optional[str]) -> str:
    """Validate and normalize wish_list parameter"""
    if not value:
        return "false"
    normalized = str(value).lower().strip()
    return normalized if normalized in ("true", "false") else "false"


def build_fetch_query(
    subgroups: Optional[str],
    classnames: Optional[str],
    only_wish_list: Optional[str]
) -> tuple[str, list]:
    """Build optimized SQL query for fetching items"""
    base = "SELECT ean, item_name, subgroups, class, count, timestamps FROM item_list"
    conditions = []
    params = []
    
    if subgroups:
        params.append(subgroups)
        conditions.append(f"subgroups = ${len(params)}")
    
    if classnames:
        params.append(classnames)
        conditions.append(f"class = ${len(params)}")
    
    if only_wish_list == "true":
        params.append("true")
        conditions.append(f"iswished = ${len(params)}")
    elif only_wish_list == "false":
        conditions.append("COALESCE(lower(iswished::text), '') <> 'true'")
    
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    limit = "" if any([subgroups, classnames, only_wish_list]) else " LIMIT 1000"
    
    return f"{base}{where} ORDER BY item_name{limit}", params


def purge_folder(folder_path: str) -> None:
    """Clean up files in folder (except symlinks)"""
    folder = Path(folder_path)
    if not folder.exists():
        return
    for p in folder.iterdir():
        if p.is_symlink():
            continue
        if p.is_file():
            try:
                p.unlink()
            except Exception as e:
                logger.warning(f"Failed to delete {p}: {e}")


# ============================================================================
# PYDANTIC MODELS (Data Transfer Objects)
# ============================================================================
class GroceryItem(BaseModel):
    """Core item representation"""
    ean: str
    item_name: str
    subgroups: str = ""
    class_name: str = ""
    count: int = 1
    perish_dates: list[str] = []
    is_wish_list: bool = False


class ItemUpdateRequest(BaseModel):
    """Request model for item updates"""
    ean: Optional[str] = None
    item_name: Optional[str] = None
    subgroups: Optional[str] = None
    count: Optional[int] = 1
    is_wish_list: Optional[bool] = False


class ItemUpdateResponse(BaseModel):
    """Response model for item updates"""
    ean: str
    product_name: str
    subgroups: str = ""
    operation: str  # 'created', 'updated', 'deleted', 'created_new'
    execution_time: Optional[float] = None


class ItemListResponse(BaseModel):
    """Response model for item list"""
    items: list[GroceryItem]
    total: int


class MetadataResponse(BaseModel):
    """Response model for metadata"""
    subgroups: list[str]
    classnames: list[str]


class BatchUpdateItem(BaseModel):
    """Single item in batch update"""
    item_name: str
    count_delta: int


class BatchUpdateRequest(BaseModel):
    """Request model for batch updates"""
    items: list[BatchUpdateItem]


class BatchUpdateResponse(BaseModel):
    """Response model for batch updates"""
    updated: int
    failed: int
    errors: list[str]


# ============================================================================
# APPLICATION LIFESPAN
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager with self-healing initialization"""
    try:
        # Initialize database pool with retry
        for attempt in range(Config.DB_RETRY_ATTEMPTS):
            try:
                app.state.pool = await asyncpg.create_pool(
                    Config.get_database_url(),
                    min_size=Config.DB_POOL_MIN_SIZE,
                    max_size=Config.DB_POOL_MAX_SIZE,
                    command_timeout=Config.DB_COMMAND_TIMEOUT,
                    server_settings={'jit': 'off'}
                )
                logger.info("Database pool created successfully")
                break
            except Exception as e:
                logger.error(f"Database pool creation failed (attempt {attempt + 1}): {e}")
                if attempt < Config.DB_RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(Config.DB_RETRY_DELAY * (attempt + 1))
                else:
                    raise
        
        # Initialize database manager
        app.state.db = DatabaseManager(app.state.pool)
        
        # Initialize database schema
        await init_database(app.state.pool)
        
        # Initialize Whisper model (conditional)
        app.state.whisper = None
        if Config.ENABLE_WHISPER_MODEL_LOCAL:
            try:
                app.state.whisper = init_whisper(cloud=False)
                logger.info("Whisper model loaded (local)")
            except Exception as e:
                logger.error(f"Whisper initialization failed: {e}")
        elif Config.ENABLE_WHISPER_MODEL_CLOUD:
            logger.info("Whisper cloud mode enabled")
        
        # Initialize ML model (conditional)
        app.state.net = None
        if Config.ENABLE_ML_MODEL:
            try:
                net = food_classifier.create_net(num_classes=206)
                model_path = os.path.join(
                    food_classifier.get_relative_path(),
                    "food_classifier_resnet50.pth"
                )
                if os.path.exists(model_path):
                    net.load_state_dict(torch.load(model_path, weights_only=True))
                    app.state.net = net.to(device)
                    logger.info("ML model loaded")
                else:
                    logger.warning(f"Model file not found: {model_path}")
            except Exception as e:
                logger.error(f"ML model loading failed: {e}")
        
        yield
        
    finally:
        if hasattr(app.state, 'pool') and app.state.pool:
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
    expose_headers=["*"]
)


@app.middleware("http")
async def request_middleware(request: Request, call_next):
    """Request logging and error handling middleware"""
    start_time = time.time()
    
    try:
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
            }
        )


# ============================================================================
# NEW RESTful API ENDPOINTS (Optimized & Consistent Naming)
# ============================================================================

@app.get("/api/items")
async def get_items(
    request: Request,
    subgroups: Optional[str] = Query(None),
    classnames: Optional[str] = Query(None),
    only_wish_list: Optional[bool] = Query(None)
) -> ItemListResponse:
    """
    Fetch items with optional filters (NEW optimized endpoint)
    
    This endpoint uses a cleaner response format and improved performance.
    For backwards compatibility, the old /fetch_items endpoint is still available.
    """
    logger.info(f"get_items: subgroups={subgroups}, classnames={classnames}, only_wish_list={only_wish_list}")
    
    try:
        # Convert boolean to string for build_fetch_query
        wish_list_str = None
        if only_wish_list is True:
            wish_list_str = "true"
        elif only_wish_list is False:
            wish_list_str = "false"
        
        query, params = build_fetch_query(subgroups, classnames, wish_list_str)
        rows = await request.app.state.db.fetch_with_retry(query, *params)
        
        items = []
        for row in rows:
            perish_dates = []
            try:
                perish_dates = json.loads(row['timestamps'] or '[]')
                # Convert ISO timestamps to dates
                perish_dates = [
                    datetime.datetime.fromisoformat(t).date().isoformat()
                    for t in perish_dates
                ]
            except (json.JSONDecodeError, ValueError):
                perish_dates = []
            
            items.append(GroceryItem(
                ean=row['ean'] or '',
                item_name=row['item_name'] or '',
                subgroups=row['subgroups'] or '',
                class_name=row['class'] or '',
                count=row['count'] or 0,
                perish_dates=perish_dates,
                is_wish_list=False  # TODO: Add iswished column check
            ))
        
        logger.info(f"get_items returned {len(items)} items")
        return ItemListResponse(items=items, total=len(items))
        
    except Exception as e:
        logger.error(f"get_items error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to fetch items")


async def addByDataDump(
    request: Request,
    ean: Optional[str] = Query(None),
    item_name: Optional[str] = Query(None),
    subgroups: Optional[str] = Query(None),
    count: Optional[int] = Query(1),
    is_wish_list: Optional[bool] = Query(False)):
    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                # Resolve item_name from EAN if needed
                resolved_item_name = item_name
                resolved_ean = ean or "0"
                is_wish_list_str = "true" if is_wish_list else "false"
                count = count if count else 1
                start_time = time.time()
                subgroups = subgroups if subgroups else "none"
                
                if ean and not item_name:
                    row = await con.fetchrow(
                        "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                    )
                    if row:
                        resolved_item_name = row['item_name']
                    else:
                        row = await con.fetchrow(
                            "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
                        )
                        if row:
                            resolved_item_name = row['product_name']
                        else:
                            raise HTTPException(status_code=404, detail=f"Item not found for EAN: {ean}")
                
                # Fast path: Single query for common operations
                current_time = datetime.datetime.now().isoformat()
                
                # Check existing item
                existing = await con.fetchrow(
                    "SELECT count, timestamps FROM item_list WHERE item_name = $1",
                    resolved_item_name
                )
                
                if not existing:
                    # Create new item
                    timestamps = [current_time] * count if count > 0 else []
                    await con.execute(
                        """INSERT INTO item_list 
                           (ean, item_name, subgroups, class, count, timestamps, iswished) 
                           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                        resolved_ean, resolved_item_name, subgroups, "", count,
                        json.dumps(timestamps), is_wish_list_str
                    )
                    operation = "created"
                else:
                    # Update existing item
                    existing_count = existing['count']
                    existing_ts = json.loads(existing['timestamps'] or '[]')
                    
                    if count < 0:
                        to_remove = min(abs(count), existing_count)
                        new_ts = existing_ts[to_remove:]
                        new_count = existing_count - to_remove
                    else:
                        new_ts = existing_ts + [current_time] * count
                        new_count = existing_count + count
                    
                    if new_count <= 0:
                        await con.execute(
                            "DELETE FROM item_list WHERE item_name = $1",
                            resolved_item_name
                        )
                        operation = "deleted"
                    else:
                        await con.execute(
                            "UPDATE item_list SET count = $1, timestamps = $2 WHERE item_name = $3",
                            new_count, json.dumps(new_ts), resolved_item_name
                        )
                        operation = "updated"
                
                execution_time = time.time() - start_time
                
                return ItemUpdateResponse(
                    ean=resolved_ean,
                    product_name=resolved_item_name or "",
                    subgroups=subgroups,
                    operation=operation,
                    execution_time=execution_time
                )
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_item error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to update item")



def constructFetchUrlOpenfood(ean: str | int) -> str:
    if isinstance(ean, int):
        ean = str(ean)  
    return f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=product_name"
    
async def getProduct(request: Request, ean: str, item_name: str, useDbDump: bool = False) -> tuple[str, str, bool]:
    if useDbDump:
        async with request.app.state.pool.acquire() as con:
            if ean and not item_name:
                # Fixed: reduced indentation
                row = await con.fetchrow(
                    "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                )
                if row:
                    resolved_item_name = row['item_name']
                else:
                    row = await con.fetchrow(
                        "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
                    )
                    if row:
                        resolved_item_name = row['product_name']
                    else:
                        raise HTTPException(status_code=404, detail=f"Item not found for EAN: {ean}")
                            
            existing = await con.fetchrow(
                "SELECT count, timestamps FROM item_list WHERE item_name = $1",
                resolved_item_name
            )
        return (ean, resolved_item_name, existing)
    
    else:
        resp: requests.Response = requests.get(url=constructFetchUrlOpenfood(ean))
        if resp.status_code == 200:
            jsonResp = resp.json()
            resolved_item_name: str = jsonResp["product"]["product_name"]
            existing = True
            print(f"api request yielded this json: {jsonResp}")  # Moved inside if block
        else:
            resolved_item_name = ""  # Provide default value
            existing = False
            
        return (ean, resolved_item_name, existing)
        
@app.get("/api/items/update")
async def update_item_endpoint(
    request: Request,
    ean: Optional[str] = Query(None),
    item_name: Optional[str] = Query(None),
    subgroups: Optional[str] = Query(None),
    count: Optional[int] = Query(1),
    is_wish_list: Optional[bool] = Query(False)
) -> ItemUpdateResponse:
    """
    Update item (NEW optimized endpoint)
    
    This endpoint provides faster performance for high-frequency operations.
    Uses optimized database queries and reduced transaction overhead.
    For backwards compatibility, old endpoints remain available.
    """
    useDataDump: bool = False
    
    # Validate input
    if not ean and not item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")
    
    count = safe_int(count, 1)
    subgroups = sanitize_string(subgroups)
    
    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                # Resolve item_name from EAN if needed
                resolved_item_name = item_name
                resolved_ean = ean or "0"
                is_wish_list_str = "true" if is_wish_list else "false"
                count = count if count else 1
                start_time = time.time()
                subgroups = subgroups if subgroups else "none"
                
                resolved_ean, resolved_item_name, existing = getProductByEan(ean=ean, item_name=item_name)
                
                # Fast path: Single query for common operations
                current_time = datetime.datetime.now().isoformat()
                
                
                
                if not existing:
                    # Create new item
                    timestamps = [current_time] * count if count > 0 else []
                    await con.execute(
                        """INSERT INTO item_list 
                           (ean, item_name, subgroups, class, count, timestamps, iswished) 
                           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                        resolved_ean, resolved_item_name, subgroups, "", count,
                        json.dumps(timestamps), is_wish_list_str
                    )
                    operation = "created"
                else:
                    # Update existing item
                    existing_count = existing['count']
                    existing_ts = json.loads(existing['timestamps'] or '[]')
                    
                    if count < 0:
                        to_remove = min(abs(count), existing_count)
                        new_ts = existing_ts[to_remove:]
                        new_count = existing_count - to_remove
                    else:
                        new_ts = existing_ts + [current_time] * count
                        new_count = existing_count + count
                    
                    if new_count <= 0:
                        await con.execute(
                            "DELETE FROM item_list WHERE item_name = $1",
                            resolved_item_name
                        )
                        operation = "deleted"
                    else:
                        await con.execute(
                            "UPDATE item_list SET count = $1, timestamps = $2 WHERE item_name = $3",
                            new_count, json.dumps(new_ts), resolved_item_name
                        )
                        operation = "updated"
                
                execution_time = time.time() - start_time
                
                return ItemUpdateResponse(
                    ean=resolved_ean,
                    product_name=resolved_item_name or "",
                    subgroups=subgroups,
                    operation=operation,
                    execution_time=execution_time
                )
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_item error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to update item")
        
        


@app.post("/api/items/batch")
async def batch_update_items(
    request: Request,
    batch_request: BatchUpdateRequest
) -> BatchUpdateResponse:
    """
    Batch update multiple items (NEW optimized endpoint for heavy hitters)
    
    This endpoint is optimized for updating multiple items in a single request,
    reducing network overhead and improving performance for bulk operations.
    """
    start_time = time.time()
    updated = 0
    failed = 0
    errors = []
    
    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                current_time = datetime.datetime.now().isoformat()
                
                for item in batch_request.items:
                    try:
                        # Get existing item
                        existing = await con.fetchrow(
                            "SELECT count, timestamps FROM item_list WHERE item_name = $1",
                            item.item_name
                        )
                        
                        if not existing:
                            errors.append(f"Item not found: {item.item_name}")
                            failed += 1
                            continue
                        
                        existing_count = existing['count']
                        existing_ts = json.loads(existing['timestamps'] or '[]')
                        
                        if item.count_delta < 0:
                            to_remove = min(abs(item.count_delta), existing_count)
                            new_ts = existing_ts[to_remove:]
                            new_count = existing_count - to_remove
                        else:
                            new_ts = existing_ts + [current_time] * item.count_delta
                            new_count = existing_count + item.count_delta
                        
                        if new_count <= 0:
                            await con.execute(
                                "DELETE FROM item_list WHERE item_name = $1",
                                item.item_name
                            )
                        else:
                            await con.execute(
                                "UPDATE item_list SET count = $1, timestamps = $2 WHERE item_name = $3",
                                new_count, json.dumps(new_ts), item.item_name
                            )
                        
                        updated += 1
                        
                    except Exception as e:
                        errors.append(f"{item.item_name}: {str(e)}")
                        failed += 1
        
        execution_time = time.time() - start_time
        logger.info(f"batch_update completed in {execution_time:.2f}s: {updated} updated, {failed} failed")
        
        return BatchUpdateResponse(updated=updated, failed=failed, errors=errors)
        
    except Exception as e:
        logger.error(f"batch_update error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Batch update failed")


@app.get("/api/metadata")
async def get_metadata(request: Request) -> MetadataResponse:
    """
    Fetch all metadata in single request (NEW optimized endpoint)
    
    Combines subgroups and classnames into one call to reduce round trips.
    This is faster than calling /fetch_subgroups and /fetch_classnames separately.
    """
    try:
        async with request.app.state.pool.acquire() as con:
            subgroups_rows, classnames_rows = await asyncio.gather(
                con.fetch(get_distinct_query("subgroups")),
                con.fetch(get_distinct_query("class"))
            )
        
        return MetadataResponse(
            subgroups=[r['subgroups'] for r in subgroups_rows],
            classnames=[r['class'] for r in classnames_rows]
        )
    except Exception as e:
        logger.error(f"get_metadata error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch metadata")


@app.get("/api/metadata/subgroups")
async def get_subgroups(request: Request):
    """Fetch only subgroups (NEW endpoint)"""
    try:
        rows = await request.app.state.db.fetch_with_retry(get_distinct_query("subgroups"))
        return {"subgroups": [r['subgroups'] for r in rows]}
    except Exception as e:
        logger.error(f"get_subgroups error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch subgroups")


@app.get("/api/metadata/classnames")
async def get_classnames(request: Request):
    """Fetch only classnames (NEW endpoint)"""
    try:
        rows = await request.app.state.db.fetch_with_retry(get_distinct_query("class"))
        return {"classnames": [r['class'] for r in rows]}
    except Exception as e:
        logger.error(f"get_classnames error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch classnames")


# ============================================================================
# LEGACY API ENDPOINTS (Backwards Compatibility - Deprecated)
# ============================================================================

@app.get("/fetch_subgroups")
async def fetch_subgroups(request: Request):
    """
    Fetch distinct subgroups
    
    @deprecated Use /api/metadata/subgroups or /api/metadata instead
    This endpoint is maintained for backwards compatibility only.
    """
    try:
        rows = await request.app.state.db.fetch_with_retry(get_distinct_query("subgroups"))
        return {"subgroups": [r['subgroups'] for r in rows]}
    except Exception as e:
        logger.error(f"fetch_subgroups error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch subgroups")


@app.get("/fetch_classnames")
async def fetch_classnames(request: Request):
    """
    Fetch distinct class names
    
    @deprecated Use /api/metadata/classnames or /api/metadata instead
    This endpoint is maintained for backwards compatibility only.
    """
    try:
        rows = await request.app.state.db.fetch_with_retry(get_distinct_query("class"))
        return {"classnames": [r['class'] for r in rows]}
    except Exception as e:
        logger.error(f"fetch_classnames error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch classnames")


@app.get("/fetch_all_metadata")
async def fetch_all_metadata(request: Request):
    """
    Fetch subgroups and classnames in single request
    
    @deprecated Use /api/metadata instead (same functionality, better naming)
    This endpoint is maintained for backwards compatibility only.
    """
    try:
        async with request.app.state.pool.acquire() as con:
            subgroups, classnames = await asyncio.gather(
                con.fetch(get_distinct_query("subgroups")),
                con.fetch(get_distinct_query("class"))
            )
        return {
            "subgroups": [r['subgroups'] for r in subgroups],
            "classnames": [r['class'] for r in classnames]
        }
    except Exception as e:
        logger.error(f"fetch_all_metadata error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch metadata")


@app.get("/fetch_items")
async def fetch_items(
    request: Request,
    subgroups: Optional[str] = Query(None),
    classnames: Optional[str] = Query(None),
    only_wish_list: Optional[str] = Query(None)
):
    """
    Fetch items with optional filters
    
    @deprecated Use /api/items instead for better performance and cleaner response
    This endpoint is maintained for backwards compatibility only.
    """
    logger.info(f"fetch_items: subgroups={subgroups}, classnames={classnames}, only_wish_list={only_wish_list}")
    
    try:
        query, params = build_fetch_query(subgroups, classnames, only_wish_list)
        rows = await request.app.state.db.fetch_with_retry(query, *params)
        
        item_list = [
            (
                row['ean'],
                row['item_name'],
                row['subgroups'] or '',
                row['class'] or '',
                row['count'],
                convert_timestamps_to_dates(row['timestamps'])
            )
            for row in rows
        ]
        
        logger.info(f"fetch_items returned {len(item_list)} items")
        return {"item_list": item_list}
        
    except Exception as e:
        logger.error(f"fetch_items error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to fetch items")


@app.get("/add_ean_to_list/")
async def add_ean_to_list(
    request: Request,
    ean: Optional[str] = Query(None, min_length=8, max_length=14),
    subgroups: Optional[str] = Query(None),
    count: Optional[int] = Query(1),
    item_name: Optional[str] = Query(None),
    wish_list: Optional[str] = Query(None)
):
    """
    Add item to list by EAN or name
    
    @deprecated Use /api/items/update instead for better performance
    This endpoint is maintained for backwards compatibility only.
    """
    if not ean and not item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")
    
    count = safe_int(count, 1)
    subgroups = sanitize_string(subgroups)
    wish_list = validate_wish_list(wish_list)
    
    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                # Resolve item_name from EAN
                if ean and not item_name:
                    row = await con.fetchrow(
                        "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                    )
                    if row:
                        item_name = row['item_name']
                    else:
                        row = await con.fetchrow(
                            "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
                        )
                        if row:
                            item_name = row['product_name']
                        else:
                            raise HTTPException(status_code=404, detail=f"Item not found for EAN: {ean}")
                
                # Resolve EAN from item_name
                elif item_name and not ean:
                    row = await con.fetchrow(
                        "SELECT ean FROM item_list WHERE item_name = $1 LIMIT 1", item_name
                    )
                    ean = row['ean'] if row else "-1"
                
                # Process item addition/update
                current_time = datetime.datetime.now().isoformat()
                existing = await con.fetchrow(
                    "SELECT count, timestamps FROM item_list WHERE item_name = $1", item_name
                )
                
                if not existing:
                    timestamps = [current_time] * count if count > 0 else []
                    await con.execute(
                        """INSERT INTO item_list 
                           (ean, item_name, subgroups, class, count, timestamps, iswished) 
                           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                        ean, item_name, subgroups, "", count, json.dumps(timestamps), wish_list
                    )
                else:
                    existing_count = existing['count']
                    existing_ts = json.loads(existing['timestamps'] or '[]')
                    
                    if count < 0:
                        to_remove = min(abs(count), existing_count)
                        new_ts = existing_ts[to_remove:]
                        new_count = existing_count - to_remove
                    else:
                        new_ts = existing_ts + [current_time] * count
                        new_count = existing_count + count
                    
                    if new_count <= 0:
                        await con.execute("DELETE FROM item_list WHERE item_name = $1", item_name)
                    else:
                        await con.execute(
                            "UPDATE item_list SET count = $1, timestamps = $2 WHERE item_name = $3",
                            new_count, json.dumps(new_ts), item_name
                        )
                
                # Get product name for response
                product_row = await con.fetchrow(
                    "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
                )
                product_name = product_row['product_name'] if product_row else item_name
                
                return {
                    "ean": ean,
                    "product_name": product_name,
                    "done": True,
                    "subgroups": subgroups
                }
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"add_ean_to_list error: {e}")
        raise HTTPException(status_code=500, detail="Failed to add item")


@app.get("/add_ean_to_list_manual/")
async def add_ean_manual(
    request: Request,
    ean: Optional[str] = Query(None, min_length=8, max_length=14),
    subgroups: Optional[str] = Query(None),
    count: Optional[Union[int, str]] = Query(1),
    item_name: Optional[str] = Query(None),
    is_wish_list: Optional[str] = Query(None)
):
    """
    Enhanced manual EAN addition with comprehensive error handling
    
    @deprecated Use /api/items/update instead for better performance and consistency
    This endpoint is maintained for backwards compatibility only.
    """
    start_time = time.time()
    op_id = f"{int(time.time() * 1000)}"
    
    logger.info(f"[{op_id}] add_ean_manual: ean={ean}, item_name={item_name}, count={count}")
    
    # Input validation
    count = safe_int(count, 1)
    
    if not ean and not item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")
    
    is_wish_list = validate_wish_list(is_wish_list)
    subgroups = sanitize_string(subgroups)
    ean = sanitize_string(ean, "0")
    item_name = sanitize_string(item_name) if item_name else None
    
    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                # Resolve item_name from EAN
                if ean != "0" and not item_name:
                    row = await con.fetchrow(
                        "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                    )
                    if row:
                        item_name = row['item_name']
                    else:
                        row = await con.fetchrow(
                            "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
                        )
                        if row:
                            item_name = row['product_name']
                        else:
                            raise HTTPException(status_code=404, detail=f"Item not found for EAN: {ean}")
                
                # Resolve EAN from item_name
                elif item_name and ean == "0":
                    row = await con.fetchrow(
                        "SELECT ean FROM item_list WHERE item_name = $1 LIMIT 1", item_name
                    )
                    ean = row['ean'] if row else "0"
                
                # Check for new EAN entry
                if item_name and ean != "0":
                    existing_by_ean = await con.fetchrow(
                        "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                    )
                    
                    if not existing_by_ean:
                        current_time = datetime.datetime.now().isoformat()
                        timestamps = [current_time] * count if count > 0 else []
                        
                        await con.execute(
                            """INSERT INTO item_list 
                               (ean, item_name, subgroups, class, count, timestamps, iswished) 
                               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                            ean, item_name, subgroups, "", count, json.dumps(timestamps), is_wish_list
                        )
                        
                        return {
                            "ean": ean,
                            "product_name": item_name,
                            "done": True,
                            "subgroups": subgroups,
                            "operation": "created_new",
                            "execution_time": time.time() - start_time
                        }
                
                # Process existing item
                current_time = datetime.datetime.now().isoformat()
                existing = await con.fetchrow(
                    "SELECT ean, count, timestamps FROM item_list WHERE item_name = $1", item_name
                )
                
                if not existing:
                    timestamps = [current_time] * count if count > 0 else []
                    await con.execute(
                        """INSERT INTO item_list 
                           (ean, item_name, subgroups, class, count, timestamps, iswished) 
                           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                        ean, item_name, subgroups, "", count, json.dumps(timestamps), is_wish_list
                    )
                    operation = "created"
                else:
                    existing_count = existing['count']
                    existing_ts = json.loads(existing['timestamps'] or '[]')
                    
                    if count < 0:
                        to_remove = min(abs(count), existing_count)
                        new_ts = existing_ts[to_remove:]
                        new_count = existing_count - to_remove
                    else:
                        new_ts = existing_ts + [current_time] * count
                        new_count = existing_count + count
                    
                    if new_count <= 0:
                        await con.execute("DELETE FROM item_list WHERE item_name = $1", item_name)
                        operation = "deleted"
                    else:
                        await con.execute(
                            "UPDATE item_list SET count = $1, timestamps = $2 WHERE item_name = $3",
                            new_count, json.dumps(new_ts), item_name
                        )
                        operation = "updated"
                
                execution_time = time.time() - start_time
                logger.info(f"[{op_id}] Completed in {execution_time:.2f}s, operation={operation}")
                
                return {
                    "ean": ean,
                    "product_name": item_name,
                    "done": True,
                    "subgroups": subgroups,
                    "operation": operation,
                    "execution_time": execution_time
                }
                
    except HTTPException:
        raise
    except asyncpg.PostgresError as e:
        logger.error(f"[{op_id}] Database error: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    except Exception as e:
        logger.error(f"[{op_id}] Unexpected error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to add item")


@app.post("/send_inference_image")
async def send_inference_image(request: Request, image: UploadFile | None = None):
    """Process image for food classification"""
    if not image:
        return {"message": "No upload file sent"}
    
    if not Config.ENABLE_ML_MODEL or not request.app.state.net:
        raise HTTPException(status_code=503, detail="ML model not available")
    
    temp_path = None
    try:
        temp_path = f"/tmp/temp_image_{time.time()}.jpg"
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(image.file, f)
        
        probability, prediction = food_classifier.run_inference(temp_path, request.app.state.net)
        return {"prediction": prediction, "probability": probability}
        
    except Exception as e:
        logger.error(f"Image inference error: {e}")
        raise HTTPException(status_code=500, detail="Failed to process image")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


@app.post("/transcribe")
async def transcribe_endpoint(request: Request, ListTypesInput: Optional[str] = Query(None), file: UploadFile = File(...)):
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
            listType = ListTypes.itemList # let the listType stay with the default
            print(f"stood with the default list type value: {listType}")
            
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
            model=request.app.state.whisper,
            cloud=Config.ENABLE_WHISPER_MODEL_CLOUD
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
        print(f"action retrieved: {action_retrieved}")
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                
                if action_retrieved == "remove":
                    numberToAdd = "- 1"
                elif action_retrieved == "add":
                    numberToAdd: str = "+ 1"
                else:
                    pass # if action is unknown just go on for now
                    
                # only go after those in the item list
                if listType == ListTypes.itemList:
                    await con.execute(
                        f"UPDATE item_list SET count = count {numberToAdd} WHERE item_name = $1",
                        class_retrieved
                    )
                    await con.execute("DELETE FROM item_list WHERE count <= 0")
                # only go after those in the wish list
                elif listType == ListTypes.wishList:
                    
                    await con.execute(
                        f"UPDATE item_list SET count = count {numberToAdd} WHERE item_name = $1 and iswished = 'true' ", 
                        class_retrieved
                    )
                    await con.execute("DELETE FROM item_list WHERE count <= 0")
                else:
                    print("executing nothing")
                    
        return {
            "transcribed_text": transcribed_text,
            "class_retrieved": class_retrieved,
            "size": len(contents),
            "filename": os.path.basename(file_path)
        }
        
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
        purge_folder("uploads")


@app.api_route("/transcribe/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy(request: Request, path: str):
    """Proxy requests to backend"""
    async with httpx.AsyncClient() as client:
        url = f"{Config.BACKEND_URL}/{path}"
        body = await request.body()
        resp = await client.request(
            request.method,
            url,
            headers=dict(request.headers),
            content=body,
            timeout=None
        )
        return StreamingResponse(
            resp.aiter_raw(),
            status_code=resp.status_code,
            headers=resp.headers
        )


@app.get("/health")
async def health_check(request: Request):
    """Health check endpoint for monitoring"""
    status = {"status": "healthy", "timestamp": datetime.datetime.now().isoformat()}
    
    # Check database connection
    try:
        await request.app.state.db.fetchval_with_retry("SELECT 1")
        status["database"] = "connected"
    except Exception:
        status["database"] = "disconnected"
        status["status"] = "degraded"
    
    # Check optional services
    status["whisper"] = "enabled" if (
        Config.ENABLE_WHISPER_MODEL_LOCAL or Config.ENABLE_WHISPER_MODEL_CLOUD
    ) else "disabled"
    status["ml_model"] = "loaded" if request.app.state.net else "disabled"
    
    return status


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================
if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=3030,
        reload=False,
        log_level="info",
        workers=1,
        loop="uvloop",
        http="httptools",
        access_log=True
    )
