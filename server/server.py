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
from fastapi import FastAPI, File, Query, Request, UploadFile, HTTPException, BackgroundTasks
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


# ============================================================================
# DATABASE SCHEMA DEFINITION (Single Source of Truth)
# ============================================================================
DATABASE_SCHEMA = {
    "food": {
        "columns": [
            ("code", "TEXT"),
            ("product_name", "TEXT"),
            ("quantity", "TEXT"),
            ("packaging", "TEXT"),
            ("brands_en", "TEXT"),
            ("categories", "TEXT"),
            ("ingredients_text", "TEXT"),
            ("energy_kcal_100g", "TEXT"),
        ],
        "indexes": [
            ("idx_food_code", "code"),
            ("idx_food_product_name", "product_name"),
        ],
    },
    "item_list": {
        "columns": [
            ("id", "SERIAL PRIMARY KEY"),
            ("ean", "TEXT"),
            ("item_name", "TEXT"),
            ("subgroups", "TEXT DEFAULT ''"),
            ("class", "TEXT DEFAULT ''"),
            ("count", "INTEGER DEFAULT 1"),
            ("timestamps", "JSONB DEFAULT '[]'::jsonb"),
            ("iswished", "TEXT DEFAULT 'false'"),
            ("image_url", "TEXT DEFAULT '' ")
        ],
        "indexes": [
            ("idx_item_list_ean", "ean"),
            ("idx_item_list_item_name", "item_name"),
            ("idx_item_list_subgroups", "subgroups"),
            ("idx_item_list_class", "class"),
            ("idx_item_list_iswished", "iswished"),
        ],
    },
}


async def ensure_schema_compliance(pool: asyncpg.Pool) -> None:
    """
    Ensure database tables match the defined schema.
    Creates missing tables, adds missing columns, and creates indexes.
    This is idempotent and safe to run multiple times.
    """
    async with pool.acquire() as con:
        for table_name, schema in DATABASE_SCHEMA.items():
            logger.info(f"Ensuring schema compliance for table: {table_name}")
            
            # Check if table exists
            table_exists = await con.fetchval(
                """
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                )
                """,
                table_name
            )
            
            if not table_exists:
                # Create table from schema
                columns_def = ", ".join([f"{col} {col_type}" for col, col_type in schema["columns"]])
                create_sql = f"CREATE TABLE {table_name} ({columns_def})"
                await con.execute(create_sql)
                logger.info(f"✓ Created table: {table_name}")
            else:
                # Table exists - ensure all columns are present
                existing_columns = await con.fetch(
                    """
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                    """,
                    table_name
                )
                existing_col_names = {row['column_name'] for row in existing_columns}
                
                # Add missing columns
                for col_name, col_def in schema["columns"]:
                    # Extract just the column name (without PRIMARY KEY, DEFAULT, etc.)
                    base_col_name = col_name.strip()
                    
                    if base_col_name not in existing_col_names:
                        try:
                            await con.execute(
                                f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_def}"
                            )
                            logger.info(f"✓ Added column: {table_name}.{col_name}")
                        except Exception as e:
                            # Column might already exist or be constrained
                            logger.debug(f"Column addition skipped for {table_name}.{col_name}: {e}")
            
            # Create indexes
            for idx_name, idx_column in schema["indexes"]:
                try:
                    await con.execute(
                        f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table_name}({idx_column})"
                    )
                    logger.debug(f"✓ Ensured index: {idx_name}")
                except Exception as e:
                    logger.debug(f"Index creation skipped for {idx_name}: {e}")


async def load_data_from_sources(pool: asyncpg.Pool) -> None:
    """
    Load data from available sources (SQL dump or CSV).
    Only loads if tables are empty.
    """
    dump_path = os.environ.get("PG_DUMP", "maindb.sql")
    csv_path = Config.get_csv_path()
    
    dump_path_variants = [
        f"/app/{dump_path}",
        f"/server/{dump_path}",
        f"{get_script_path(0)}/{dump_path}",
        f"{get_script_path(-1)}/{dump_path}",
        f"{get_script_path(-2)}/{dump_path}",
    ]
    
    user, host, port, dbname, env = parse_db_url(Config.get_database_url())
    
    async with pool.acquire() as con:
        food_count = await con.fetchval("SELECT COUNT(*) FROM food") or 0
    
    if food_count > 0:
        logger.info(f"Food table already populated with {food_count} rows")
        return
    
    logger.info("Food table empty - attempting to load data from available sources")
    
    # Try SQL dump first
    for variant in dump_path_variants:
        if os.path.exists(variant):
            logger.info(f"Found SQL dump: {variant}")
            cmd = ["psql", "-U", user, "-d", dbname, "-f", variant]
            if host:
                cmd[1:1] = ["-h", host]
            if port:
                cmd[1:1] = ["-p", port]
            
            rc, out, err = await run_psql_command(cmd, env)
            if rc == 0:
                logger.info("✓ Successfully loaded data from SQL dump")
                return
            else:
                logger.warning(f"SQL dump restore failed: {err}")
    
    # Fallback to CSV
    if os.path.exists(csv_path):
        logger.info(f"Attempting to load data from CSV: {csv_path}")
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
            logger.info("✓ Successfully loaded data from CSV")
        else:
            logger.error(f"CSV load failed: {err}")
    else:
        logger.warning(f"No data sources found. Food table will remain empty.")
        logger.info("Application will continue with empty food database")


async def init_database(pool: asyncpg.Pool, dump_path: str = "maindb.sql"):
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
        await ensure_schema_compliance(pool)
        logger.info("✓ Schema compliance verified")
        
        # Step 2: Load data if needed (optional, won't fail startup)
        try:
            await load_data_from_sources(pool)
        except Exception as e:
            logger.warning(f"Data loading failed (non-critical): {e}")
            logger.info("Application will continue without pre-loaded food data")
        
        # Step 3: Final status report
        async with pool.acquire() as con:
            tables_info = []
            for table_name in DATABASE_SCHEMA.keys():
                count = await con.fetchval(f"SELECT COUNT(*) FROM {table_name}") or 0
                tables_info.append(f"{table_name}({count} rows)")
            
            logger.info(f"✓ Database initialized successfully: {', '.join(tables_info)}")
            
    except Exception as e:
        logger.exception(f"Critical database initialization error: {e}")
        raise

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================
@lru_cache(maxsize=Config.LRU_CACHE_SIZE)
def get_distinct_query(field: str) -> str:
    """Cached query builder for distinct field values"""
    return f"SELECT DISTINCT {field} FROM item_list WHERE {field} != '' AND {field} IS NOT NULL ORDER BY {field}"


def convert_timestamps_to_dates(timestamps_json: str) -> list[str]:
    """Convert ISO timestamps to date strings - returns list not JSON string"""
    try:
        timestamps = json.loads(timestamps_json or '[]')
        return [datetime.datetime.fromisoformat(t).date().isoformat() for t in timestamps]
    except (json.JSONDecodeError, ValueError):
        return []


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


def convertSortToSql(sortMode: str | None = None):
    if not sortMode: 
        sortMode = "new-old" 
    
    if sortMode not in ["a-z", "z-a", "new-old", "old-new"]:
        logger.warning(f"the sort mode {sortMode} isnt supported. going back to a-z mode")
        sortMode = "a-z" 
        
    if sortMode == "a-z":
        return "order by item_name asc "

    elif sortMode == "z-a":
        return "order by item_name desc "

    elif sortMode == "new-old":
       return "ORDER BY (SELECT MAX(t)FROM jsonb_array_elements_text(timestamps) AS t) desc "

    elif sortMode == "old-new":   
        return "ORDER BY (SELECT MAX(t)FROM jsonb_array_elements_text(timestamps) AS t) asc "
    
    
def build_fetch_query(
    subgroups: Optional[str] = None,
    classnames: Optional[str] = None,
    only_wish_list: Optional[str] = None,
    onlyNotNull: Optional[str] = "true",
    sortOrder: Optional[str] = None
) -> tuple[str, list]:
    """Build optimized SQL query for fetching items with filters"""
    conditions = []
    params = []
    
    # Add filters
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
    
    # Filter out null items
    if onlyNotNull != "false":
        conditions.append("item_name IS NOT NULL AND item_name != 'null' AND item_name != ''")
    
    where_clause = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    limit_clause = "" if any([subgroups, classnames, only_wish_list]) else " LIMIT 1000"
    
    return (
        f"""SELECT ean, item_name, subgroups, class, count, timestamps, image_url
        FROM item_list{where_clause} {convertSortToSql(sortMode=sortOrder)}{limit_clause}""",
        params
    )


async def resolve_item_identity(
    con: asyncpg.Connection,
    ean: Optional[str],
    item_name: Optional[str]
) -> tuple[str, str]:
    """
    Resolve EAN and item_name from either parameter.
    Returns: (ean, item_name)
    """
    # Case 1: Both provided
    if ean and item_name:
        return (ean, item_name)
    
    # Case 2: Only EAN provided
    if ean and not item_name:
        '''
        row = await con.fetchrow(
            "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
        )
        if row:
            return (ean, row['item_name'])
        '''
        res = requests.get(f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=product_name")
        json = res.json()
        if json["status_verbose"]:
            return (ean, json["product"]["product_name"])
        
        # Fallback to food database
        row = await con.fetchrow(
            "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
        )
        if row:
            return (ean, row['product_name'])
        
        # Return generic name instead of raising 404
        return (ean, "none")
    
    # Case 3: Only item_name provided
    if item_name and not ean:
        row = await con.fetchrow(
            "SELECT ean FROM item_list WHERE item_name = $1 LIMIT 1", item_name
        )
        return (row['ean'] if row else "0", item_name)
    
    raise HTTPException(status_code=400, detail="Must provide ean or item_name")

def getImageUrl(ean: str):
    try:
        res = requests.get(f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=selected_images")
        json = res.json()
        images: dict[str, str] = json["product"]["selected_images"]["front"]["display"]
        if list(images.keys()).__contains__("en"):
            return images["en"]
        elif list(images.keys()).__contains__("de"):
            return images["de"]
        elif list(images.keys()).__contains__("fr"):
            return images["fr"]
        elif list(images.keys()).__contains__("es"):
            return images["es"]
        logger.warning(f"failed to get the image url for ean: {ean} ")
    except Exception as e:
        logger.warning(f"failed to do the image fetching for this ean: {ean}. error: {e} ")
        
        
async def perform_item_operation(
    con: asyncpg.Connection,
    item_name: str,
    ean: str = "0",
    count_delta: int = 1,
    subgroups: str = "none",
    is_wish_list: str = "false"
) -> str:
    """
    Unified item operation handler (create/update/delete).
    Returns: operation performed ('created', 'updated', 'deleted')
    """
    current_time = datetime.datetime.now().isoformat()
    
    # Fetch existing item
    existing = await con.fetchrow(
        "SELECT count, timestamps FROM item_list WHERE item_name = $1", item_name
    )
    
    if not existing:
        # Create new item
        if count_delta <= 0:
            return "skipped"  # Don't create with zero/negative count
        
        timestamps = [current_time] * count_delta
        await con.execute(
            """INSERT INTO item_list 
               (ean, item_name, subgroups, class, count, timestamps, iswished, image_url) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
            ean, item_name, subgroups, "", count_delta, json.dumps(timestamps), is_wish_list, getImageUrl(ean)
        )
        return "created"
    
    # Update existing item
    existing_count = existing['count']
    existing_ts = json.loads(existing['timestamps'] or '[]')
    
    if count_delta < 0:
        # Decrease count - remove oldest timestamps
        to_remove = min(abs(count_delta), existing_count)
        new_ts = existing_ts[to_remove:]
        new_count = existing_count - to_remove
    else:
        # Increase count - add new timestamps
        new_ts = existing_ts + [current_time] * count_delta
        new_count = existing_count + count_delta
    
    if new_count <= 0:
        # Delete item if count reaches zero
        await con.execute("DELETE FROM item_list WHERE item_name = $1", item_name)
        return "deleted"
    
    # Update item
    await con.execute(
        "UPDATE item_list SET count = $1, timestamps = $2 WHERE item_name = $3",
        new_count, json.dumps(new_ts), item_name
    )
    return "updated"


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
    imageUrl: str


class ItemUpdateRequest(BaseModel):
    """Request model for item updates"""
    ean: Optional[str] = None
    item_name: Optional[str] = None
    subgroups: Optional[str] = None
    count: Optional[int] = 1
    is_wish_list: Optional[bool] = False


class AddEanRequest(BaseModel):
    """Request model for add_ean_to_list endpoint (legacy)"""
    ean: Optional[str] = None
    item_name: Optional[str] = None
    subgroups: Optional[str] = None
    count: Optional[int] = 1
    wish_list: Optional[str] = None


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
    daemon_task = None
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
        
        # Start background daemon task (run once at startup)
        daemon_task = asyncio.create_task(shortenItemNamesDaemon(app.state.pool))
        logger.info("✓ Started item name shortening daemon")
        
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
        # cancel daemon task on shutdown
        if daemon_task and not daemon_task.done():
            daemon_task.cancel()
            try:
                await daemon_task
            except asyncio.CancelledError:
                logger.info("Daemon task cancelled")
        
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
        wish_list_str = "true" if only_wish_list is True else "false" if only_wish_list is False else None
        
        query, params = build_fetch_query(subgroups, classnames, wish_list_str)
        rows = await request.app.state.db.fetch_with_retry(query, *params)
        
        items = [
            GroceryItem(
                ean=row['ean'] or '',
                item_name=row['item_name'] or '',
                subgroups=row['subgroups'] or '',
                class_name=row['class'] or '',
                count=row['count'] or 0,
                perish_dates=convert_timestamps_to_dates(row['timestamps']),
                is_wish_list=False,
                imageUrl=row['image_url'] or '/none_available.png'
            )
            for row in rows
        ]
        
        logger.info(f"get_items returned {len(items)} items")
        return ItemListResponse(items=items, total=len(items))
        
    except Exception as e:
        logger.error(f"get_items error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to fetch items")


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
    if not ean and not item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")
    
    count_delta = safe_int(count, 1)
    subgroups = sanitize_string(subgroups, "none")
    is_wish_list_str = "true" if is_wish_list else "false"
    
    start_time = time.time()
    
    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                # Resolve item identity
                resolved_ean, resolved_item_name = await resolve_item_identity(con, ean, item_name)
                
                # Perform operation
                operation = await perform_item_operation(
                    con, resolved_item_name, resolved_ean, count_delta, subgroups, is_wish_list_str
                )
                
                execution_time = time.time() - start_time
                
                return ItemUpdateResponse(
                    ean=resolved_ean,
                    product_name=resolved_item_name,
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
                for item in batch_request.items:
                    try:
                        operation = await perform_item_operation(
                            con, item.item_name, count_delta=item.count_delta
                        )
                        if operation != "skipped":
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
    only_wish_list: Optional[str] = Query(None),
    sortOrder: Optional[str] = Query(None)
):
    """
    Fetch items with optional filters
    
    @deprecated Use /api/items instead for better performance and cleaner response
    This endpoint is maintained for backwards compatibility only.
    """
    sortOrder = sortOrder.lower() if sortOrder else sortOrder
    logger.info(f"fetch_items: subgroups={subgroups}, classnames={classnames}, only_wish_list={only_wish_list}, sortOrder={sortOrder}")
    
    try:
        query, params = build_fetch_query(subgroups, classnames, only_wish_list, sortOrder=sortOrder)
        rows = await request.app.state.db.fetch_with_retry(query, *params)
        
        item_list = [
                    {   
                        "ean": row['ean'],
                        "text": row['item_name'],
                        "subgroups": row['subgroups'] or '',
                        "classname": row['class'] or '',
                        "count": row['count'],
                        "perish_dates": convert_timestamps_to_dates(row['timestamps']),
                        "imageUrl": row['image_url'] or '/none_available.png'
                    }    
                    for row in rows
                ]
        logger.info(f"fetch_items returned {len(item_list)} items")
        
        return {"items": item_list}
        
    except Exception as e:
        logger.error(f"fetch_items error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to fetch items")



@app.get("/shorten_item_names")
async def shortenNames(request: Request):
    """Rescan all items with empty image URLs and fetch them from OpenFoodFacts"""
    try:
        rows = await request.app.state.db.fetch_with_retry("select distinct(item_name), class from item_list")
        itemNamesToClassify = []
        
        for row in rows:
            if row['class'] == '' and row['item_name'].lower() not in ['', 'none']:
                itemNamesToClassify.append(row["item_name"])
                
        updated_count = 0
        for item in itemNamesToClassify:
            item = item.strip()
            shortenedName = classifier.shortenText(item)
            if shortenedName:
                await request.app.state.db.execute_with_retry(
                    "UPDATE item_list SET class = $1 WHERE item_name = $2",
                    shortenedName,
                    item
                )
                updated_count += 1
        
        logger.info(f"Updated {updated_count} item names out of {len(itemNamesToClassify)} empty entries")
        return {"done": True, "updated": updated_count, "total_empty": len(itemNamesToClassify), "namesUpdated": str(itemNamesToClassify)}
    
    except Exception as e:
        logger.error(f"Failed while rescanning image URLs: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}
    
    
    
    
async def shortenItemNamesDaemon(pool: asyncpg.Pool):
    """Rescan all items with empty image URLs and fetch them from OpenFoodFacts"""
    try:
        async with pool.acquire() as con:
            rows = await con.fetch("select distinct(item_name), class from item_list")
            itemNamesToClassify = []
            
            for row in rows:
                if row['class'] == '' and row['item_name'].lower() not in ['', 'none']:
                    itemNamesToClassify.append(row["item_name"])
                    
            updated_count = 0
            for item in itemNamesToClassify:
                item = item.strip()
                shortenedName = classifier.shortenText(item)
                if shortenedName:
                    await con.fetchrow(
                        "UPDATE item_list SET class = $1 WHERE item_name = $2",
                        shortenedName,
                        item
                    )
                    updated_count += 1
            
            logger.info(f"Updated {updated_count} item names out of {len(itemNamesToClassify)} empty entries")
            return {"done": True, "updated": updated_count, "total_empty": len(itemNamesToClassify), "namesUpdated": str(itemNamesToClassify)}
        
    except Exception as e:
        logger.error(f"Failed while rescanning image URLs: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}
    
    
    
    
@app.get("/rescan_for_image_urls")
async def rescanImageUrls(request: Request):
    """Rescan all items with empty image URLs and fetch them from OpenFoodFacts"""
    try:
        rows = await request.app.state.db.fetch_with_retry("select distinct(ean), image_url from item_list")
        eansToMod = []
        
        for row in rows:
            if row['image_url'] == '' and row['ean'] not in ["-1", "0", "1"]:
                eansToMod.append(row["ean"])
                
        updated_count = 0
        for ean in eansToMod:
            image_url = getImageUrl(ean)
            if image_url:
                await request.app.state.db.execute_with_retry(
                    "UPDATE item_list SET image_url = $1 WHERE ean = $2",
                    image_url,
                    ean
                )
                updated_count += 1
        
        logger.info(f"Updated {updated_count} image URLs out of {len(eansToMod)} empty entries")
        return {"done": True, "updated": updated_count, "total_empty": len(eansToMod), "eansUpdated": str(eansToMod)}
    
    except Exception as e:
        logger.error(f"Failed while rescanning image URLs: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}
    
    
async def shorten_item_names_task(pool: asyncpg.Pool, item_name: str):
    """Background task to shorten a specific item name"""
    try:
        async with pool.acquire() as con:
            row = await con.fetchrow(
                "SELECT class FROM item_list WHERE item_name = $1 LIMIT 1", item_name
            )
            if row and row['class'] == '' and item_name.lower() not in ['', 'none']:
                shortened_name = classifier.shortenText(item_name.strip())
                if shortened_name:
                    await con.execute(
                        "UPDATE item_list SET class = $1 WHERE item_name = $2",
                        shortened_name,
                        item_name
                    )
                    logger.info(f"Background task: Shortened item name '{item_name}' to '{shortened_name}'")
    except Exception as e:
        logger.error(f"Background task error shortening item name: {e}")


@app.post("/add_ean_to_list/")
async def add_ean_to_list(
    request: Request,
    body: AddEanRequest,
    background_tasks: BackgroundTasks
):
    """
    Add item to list by EAN or name (POST)
    
    @deprecated Use /api/items/update instead for better performance
    This endpoint is maintained for backwards compatibility only.
    """
    if not body.ean and not body.item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")
    
    count_delta = safe_int(body.count, 1)
    subgroups = sanitize_string(body.subgroups, "none")
    wish_list = validate_wish_list(body.wish_list)
    
    logger.info(f"got ean={body.ean},count_delta={count_delta}, subgroups={subgroups}, wish_list={wish_list}, item_name={body.item_name if body.item_name else ''},")
    
    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                # Resolve item identity
                resolved_ean, resolved_item_name = await resolve_item_identity(con, body.ean, body.item_name)
                
                # Perform operation
                operation = await perform_item_operation(
                    con, resolved_item_name, resolved_ean, count_delta, subgroups, wish_list
                )
                
                is_known = resolved_item_name != "none" and resolved_ean not in ("0", "-1")
                
                # Schedule background task to shorten item name if needed
                if operation == "created" and resolved_item_name:
                    background_tasks.add_task(shorten_item_names_task, request.app.state.pool, resolved_item_name)
                
                return {
                    "ean": resolved_ean,
                    "product_name": resolved_item_name,
                    "done": is_known,
                    "subgroups": subgroups,
                    "known_to_db": is_known,
                    "operation": operation  # Added for clarity: 'created', 'updated', 'deleted'
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
    
    # Input validation and sanitization
    count_delta = safe_int(count, 1)
    if not ean and not item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")
    
    is_wish_list = validate_wish_list(is_wish_list)
    subgroups = sanitize_string(subgroups, "none")
    ean = sanitize_string(ean, "0")
    item_name = sanitize_string(item_name) if item_name else None
    
    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                # Resolve item identity
                resolved_ean, resolved_item_name = await resolve_item_identity(con, ean if ean != "0" else None, item_name)
                
                # Check for new EAN entry (special case for manual entry)
                if resolved_item_name and resolved_ean != "0":
                    existing_by_ean = await con.fetchrow(
                        "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", resolved_ean
                    )
                    
                    if not existing_by_ean:
                        operation = await perform_item_operation(
                            con, resolved_item_name, resolved_ean, count_delta, subgroups, is_wish_list
                        )
                        execution_time = time.time() - start_time
                        
                        return {
                            "ean": resolved_ean,
                            "product_name": resolved_item_name,
                            "done": True,
                            "subgroups": subgroups,
                            "operation": "created_new",
                            "execution_time": execution_time
                        }
                
                # Perform standard operation
                operation = await perform_item_operation(
                    con, resolved_item_name, resolved_ean, count_delta, subgroups, is_wish_list
                )
                
                execution_time = time.time() - start_time
                logger.info(f"[{op_id}] Completed in {execution_time:.2f}s, operation={operation}")
                
                return {
                    "ean": resolved_ean,
                    "product_name": resolved_item_name,
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
                        logger.info("executing nothing")
                else:
                    logger.info("couldnt retrieve action out of this => do nothing")
        
        response = {
            "transcribed_text": transcribed_text,
            "class_retrieved": class_retrieved,
            "size": len(contents),
            "filename": os.path.basename(file_path),
            "numberToAdd": numberToAdd,
            "action_retrieved": action_retrieved
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
