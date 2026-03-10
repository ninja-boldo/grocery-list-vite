import os
from pathlib import Path
import re
import shlex
import traceback

import httpx
from utils.dbManager import DatabaseManager
from enum import Enum
import requests
from dotenv import load_dotenv
from utils.lookup import WORD_STRIP, PHRASE_STRIP

os.environ["KMP_DUPLICATE_LIB_OK"] = "True"

import datetime
import json
from typing import Optional, Union, Any
from contextlib import asynccontextmanager
from fastapi import (
    FastAPI,
    File,
    Query,
    Request,
    UploadFile,
    HTTPException,
    BackgroundTasks,
)
import uvicorn

from fastapi.responses import JSONResponse
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
if Config.ENABLE_WHISPER_MODEL_LOCAL or Config.ENABLE_WHISPER_MODEL_CLOUD:
    from transcription.transcript import transcribe
    from transcription import classifier


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
        "constraints": "",
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
            ("last_added", "TIMESTAMP DEFAULT NOW()"),
            ("checked_last", "TIMESTAMP DEFAULT NOW()"),
            ("iswished", "TEXT DEFAULT 'false'"),
            ("image_url", "TEXT DEFAULT '' "),
            ("categories", "TEXT DEFAULT '' "),
            ("tags", "TEXT DEFAULT '' "),
            ("mapped_wish", "TEXT DEFAULT '' "),
            
        ],
        "indexes": [
            ("idx_item_list_ean", "ean"),
            ("idx_item_list_item_name", "item_name"),
            ("idx_item_list_iswished", "iswished"),
            ("idx_item_list_tags", "tags"),
            ("idx_item_list_last_added_desc", "last_added DESC"),
            ("idx_item_list_last_added_asc", "last_added ASC"),
        ],
        "constraints": "CONSTRAINT item_list_ean_name_unique UNIQUE (ean, item_name)",
    },
    "tagging_to_name": {
        "columns": [
            ("tags", "TEXT PRIMARY KEY"),
            ("inferred_name", "TEXT"),
        ],
        "indexes": [
            ("idx_tags", "tags"),
            ("idx_inferred_name", "inferred_name"),
        ],
        "constraints": "",
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
                table_name,
            )

            if not table_exists:
                # Create table from schema
                columns_def = ", ".join(
                    [f"{col} {col_type}" for col, col_type in schema["columns"]]
                )

                constraint_clause = (
                    f", {schema['constraints']}" if schema["constraints"] else ""
                )
                create_sql = (
                    f"CREATE TABLE {table_name} ({columns_def}{constraint_clause})"
                )
                print(f"creating table with sql query: {create_sql}")
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
                    table_name,
                )
                existing_col_names = {row["column_name"] for row in existing_columns}

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
                            logger.debug(
                                f"Column addition skipped for {table_name}.{col_name}: {e}"
                            )

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
        f"{app.state.db.get_script_path(0)}/{dump_path}",
        f"{app.state.db.get_script_path(-1)}/{dump_path}",
        f"{app.state.db.get_script_path(-2)}/{dump_path}",
    ]

    user, host, port, dbname, env = app.state.db.parse_db_url(Config.get_database_url())

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

            rc, out, err = await app.state.db.run_psql_command(cmd, env)
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

        rc, out, err = await app.state.db.run_psql_command(cmd, env)
        if rc == 0:
            logger.info("✓ Successfully loaded data from CSV")
        else:
            logger.error(f"CSV load failed: {err}")
    else:
        logger.warning("No data sources found. Food table will remain empty.")
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

        # Step 1: Load data if needed (optional, won't fail startup)
        try:
            await load_data_from_sources(pool)
        except Exception as e:
            logger.warning(f"Data loading failed (non-critical): {e}")
            logger.info("Application will continue without pre-loaded food data")

        # Step 2: Ensure schema compliance (always runs)
        await ensure_schema_compliance(pool)
        logger.info("✓ Schema compliance verified")

        # Step 3: Final status report
        async with pool.acquire() as con:
            tables_info = []
            for table_name in DATABASE_SCHEMA.keys():
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
@lru_cache(maxsize=Config.LRU_CACHE_SIZE)
def get_distinct_query(field: str) -> str:
    """Cached query builder for distinct field values"""
    return f"SELECT DISTINCT {field} FROM item_list WHERE {field} != '' AND {field} IS NOT NULL ORDER BY {field}"


def convert_timestamps_to_dates(timestamps_json: str) -> list[str]:
    """Convert ISO timestamps to date strings - returns list not JSON string"""
    try:
        timestamps = json.loads(timestamps_json or "[]")
        return [
            datetime.datetime.fromisoformat(t).date().strftime("%d.%m.%Y")
            for t in timestamps
        ]
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


_SORT_MODE_TO_SQL: dict[str, str] = {
    "a-z":     "ORDER BY item_name ASC",
    "z-a":     "ORDER BY item_name DESC",
    "new-old": "ORDER BY last_added DESC NULLS LAST",
    "old-new": "ORDER BY last_added ASC NULLS LAST",
}
_DEFAULT_SORT = "new-old"

def convertSortToSql(sortMode: str | None = None) -> str:
    key = (sortMode or _DEFAULT_SORT).lower().strip()
    if key not in _SORT_MODE_TO_SQL:
        logger.warning(f"Unrecognised sort mode '{sortMode}', falling back to '{_DEFAULT_SORT}'")
        key = _DEFAULT_SORT
    return _SORT_MODE_TO_SQL[key]


@lru_cache(maxsize=64)
def _build_fetch_query_template(
    has_subgroups: bool,
    has_classnames: bool,
    only_wish_list: Optional[str],
    onlyNotNull: str,
    sortOrder: Optional[str],
    has_limit: bool,
    has_skip: bool,
    include_tags: bool,
    has_search: bool,
) -> str:
    """
    Cached query template builder. Keyed only on the *shape* of the query
    (which filters are active, sort order) — not on the actual values.
    Returns a query string with $1..$N placeholders but no bound values.
    """
    conditions = []
    param_idx = 0
    fields = ["ean", "item_name", "subgroups", "class", "count", "timestamps", "image_url"]

    if has_subgroups:
        param_idx += 1
        conditions.append(f"subgroups = ${param_idx}")

    if has_classnames:
        param_idx += 1
        conditions.append(f"class = ${param_idx}")

    if only_wish_list == "true":
        param_idx += 1
        conditions.append(f"iswished = ${param_idx}")
    elif only_wish_list == "false":
        conditions.append("(iswished IS NULL OR iswished != 'true')")

    if onlyNotNull != "false":
        conditions.append("item_name IS NOT NULL AND item_name != 'null' AND item_name != ''")

    if has_search:
        param_idx += 1
        conditions.append(
            f"(item_name ILIKE ${param_idx} OR ean ILIKE ${param_idx} OR class ILIKE ${param_idx})"
        )

    if include_tags:
        fields.append("tags")

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    limit_clause = f"LIMIT ${param_idx + 1}" if has_limit else "LIMIT 1000"
    if has_limit:
        param_idx += 1

    offset_clause = f"OFFSET ${param_idx + 1}" if has_skip else ""

    return (
        f"SELECT {', '.join(fields)} FROM item_list "
        f"{where_clause} {convertSortToSql(sortOrder)} {limit_clause} {offset_clause}"
    ).strip()


def build_fetch_query(
    subgroups: Optional[str] = None,
    classnames: Optional[str] = None,
    only_wish_list: Optional[str] = None,
    onlyNotNull: str = "true",
    sortOrder: Optional[str] = None,
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    include_tags: bool = False,
    searchQuery: Optional[str] = None,
) -> tuple[str, list]:
    params = []
    if subgroups:
        params.append(subgroups)
    if classnames:
        params.append(classnames)
    if only_wish_list == "true":
        params.append("true")
    if searchQuery and searchQuery.strip():
        params.append(f"%{searchQuery.strip()}%")

    has_limit = limit is not None and limit > 0
    has_skip = skip is not None and skip > 0
    if has_limit:
        params.append(limit)
    if has_skip:
        params.append(skip)

    query = _build_fetch_query_template(
        has_subgroups=bool(subgroups),
        has_classnames=bool(classnames),
        only_wish_list=only_wish_list,
        onlyNotNull=onlyNotNull,
        sortOrder=sortOrder,
        has_limit=has_limit,
        has_skip=has_skip,
        include_tags=bool(include_tags),
        has_search=bool(searchQuery and searchQuery.strip()),
    )
    return query, params



async def resolve_item_identity(
    con: asyncpg.Connection, ean: Optional[str], item_name: Optional[str]
) -> tuple[str, str]:
    if ean and item_name:
        return (ean, item_name)

    if ean and not item_name:
        try:
            res = requests.get(
                f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=product_name",
                timeout=5.0,
            )
            data = res.json()
            if data.get("status") == 1:  # 1 = found, 0 = not found
                product_name = data.get("product", {}).get("product_name")
                if product_name:
                    return (ean, product_name)
        except Exception as e:
            logger.warning(f"OpenFoodFacts lookup failed for ean {ean}: {e}")

        # Fallback to local food table
        row = await con.fetchrow(
            "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
        )
        if row and row["product_name"]:
            return (ean, row["product_name"])

        return (ean, "none")

    if item_name and not ean:
        row = await con.fetchrow(
            "SELECT ean FROM item_list WHERE item_name = $1 LIMIT 1", item_name
        )
        return (row["ean"] if row else "0", item_name)

    raise HTTPException(status_code=400, detail="Must provide ean or item_name")


def getImageUrl(ean: str, delay: float=0.5):
    try:
        time.sleep(delay)
        res = requests.get(
            f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=selected_images"
        )
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
        logger.warning(
            f"failed to do the image fetching for this ean: {ean}. error: {e} "
        )


async def getImageUrlAsync(
    client: httpx.AsyncClient, ean: str, delay: float = 0.5
) -> str:
    try:
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


async def perform_item_operation(
    con: asyncpg.Connection,
    item_name: str,
    ean: str = "0",
    count_delta: int = 1,
    subgroups: str = "none",
    is_wish_list: str = "false",
    image_url: str = "",
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
            ean,
            item_name,
            subgroups,
            "",
            count_delta,
            json.dumps(timestamps),
            is_wish_list,
            image_url,
        )
        return "created"

    # Update existing item
    existing_count = existing["count"]
    existing_ts = json.loads(existing["timestamps"] or "[]")

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
        new_count,
        json.dumps(new_ts),
        item_name,
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

async def backfill_last_added(pool: asyncpg.Pool) -> None:
    """
    One-time startup backfill: derive last_added from the timestamps JSONB array
    for any row where last_added is still NULL or equal to the column default.
    Safe to run on every startup — only touches rows that need it.
    """
    async with pool.acquire() as con:
        updated = await con.execute("""
            UPDATE item_list
            SET last_added = (
                SELECT MAX(t::timestamp)
                FROM jsonb_array_elements_text(timestamps) AS t
            )
            WHERE last_added IS NULL
              AND timestamps IS NOT NULL
              AND jsonb_array_length(timestamps) > 0
        """)
        logger.info(f"✓ backfill_last_added: {updated}")
        
        
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


class FetchedSingleItem(BaseModel):
    ean: int
    text: str
    subgroups: str
    classname: str
    count: int
    perish_dates: list[str]
    imageUrl: str


class AddFetchedItems(BaseModel):
    items: list[FetchedSingleItem]


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
    daemon_tasks = []
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

        async with httpx.AsyncClient(
            headers={"User-Agent": "grocery-list-app/1.0"}, timeout=httpx.Timeout(5.0)
        ) as client:
            app.state.http_client = client

        # Initialize database schema
        await init_database(app.state.pool)
        
        await backfill_last_added(app.state.pool)
        
        # Initialize Whisper model (conditional)
        app.state.whisper = None

        if Config.ENABLE_WHISPER_MODEL_CLOUD:
            logger.info("Whisper cloud mode enabled")

        # Start background daemon tasks (run once at startup)
        daemon_tasks.append(asyncio.create_task(shortenItemNamesDaemon(app.state.pool)))
        logger.info("✓ Started item name shortening daemon")

        # schedule tag assignment for item grouping
        daemon_tasks.append(asyncio.create_task(assignTagsTask(app.state.pool)))
        logger.info("✓ Started tag assignment daemon")

        daemon_tasks.append(asyncio.create_task(mapItemToWishDaemon(app.state.pool)))
        logger.info("✓ Started item to wish mapping daemon")

        daemon_tasks.append(
            asyncio.create_task(assignShorthandNameToTags(app.state.pool))
        )
        logger.info("✓ Started shorthand name assignment")
        
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


# ============================================================================
# NEW RESTful API ENDPOINTS (Optimized & Consistent Naming)
# ============================================================================


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
                con.fetch(get_distinct_query("class")),
            )

        return MetadataResponse(
            subgroups=[r["subgroups"] for r in subgroups_rows],
            classnames=[r["class"] for r in classnames_rows],
        )
    except Exception as e:
        logger.error(f"get_metadata error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch metadata")


@app.get("/api/metadata/subgroups")
async def get_subgroups(request: Request):
    """Fetch only subgroups (NEW endpoint)"""
    try:
        rows = await request.app.state.db.fetch_with_retry(
            get_distinct_query("subgroups")
        )
        return {"subgroups": [r["subgroups"] for r in rows]}
    except Exception as e:
        logger.error(f"get_subgroups error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch subgroups")


@app.get("/api/metadata/classnames")
async def get_classnames(request: Request):
    """Fetch only classnames (NEW endpoint)"""
    try:
        rows = await request.app.state.db.fetch_with_retry(get_distinct_query("class"))
        return {"classnames": [r["class"] for r in rows]}
    except Exception as e:
        logger.error(f"get_classnames error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch classnames")


@app.get("/fetch_subgroups")
async def fetch_subgroups(request: Request):
    """
    Fetch distinct subgroups

    @deprecated Use /api/metadata/subgroups or /api/metadata instead
    This endpoint is maintained for backwards compatibility only.
    """
    try:
        rows = await request.app.state.db.fetch_with_retry(
            get_distinct_query("subgroups")
        )
        return {"subgroups": [r["subgroups"] for r in rows]}
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
        return {"classnames": [r["class"] for r in rows]}
    except Exception as e:
        logger.error(f"fetch_classnames error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch classnames")


'''
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
                con.fetch(get_distinct_query("class")),
            )
        return {
            "subgroups": [r["subgroups"] for r in subgroups],
            "classnames": [r["class"] for r in classnames],
        }
    except Exception as e:
        logger.error(f"fetch_all_metadata error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch metadata")
'''


@app.get("/fetch_grouped_items")
async def fetch_grouped(
    request: Request,
    tagToInlcude: Optional[str] = Query(None),
    skip: Optional[int] = Query(None),
    limit: Optional[int] = Query(None),
):
    try:
        logger.info(
            f"fetch_grouped_items received these params: tagToInlcude={tagToInlcude}, skip={skip}, limit={limit}"
        )

        if skip and skip < 0:
            skip = 0
        if limit and limit < 0:
            limit = 0

        query = """
            SELECT 
                ttn.inferred_name as short_name,
                ttn.tags,
                jsonb_agg(
                    jsonb_build_object(
                        'name', il.item_name,
                        'count', il.count
                    )
                ) as sub_items
            FROM tagging_to_name ttn 
            JOIN item_list il ON il.tags = ttn.tags
        """

        params = []
        if tagToInlcude and tagToInlcude.lower() != "none":
            params.append(tagToInlcude)
            query += f" WHERE ttn.tags = ${len(params)}"

        query += " GROUP BY ttn.inferred_name, ttn.tags ORDER BY ttn.inferred_name"

        if limit:
            params.append(limit)
            query += f" LIMIT ${len(params)}"
        if skip:
            params.append(skip)
            query += f" OFFSET ${len(params)}"

        rows = await request.app.state.db.fetch_with_retry(query, *params)

        # Convert to response format - parse JSONB to Python list
        resp = {
            row["short_name"]: {
                "subItems": json.loads(row["sub_items"])
                if isinstance(row["sub_items"], str)
                else row["sub_items"],
                "tags": row["tags"],
            }
            for row in rows
        }

        return {"items": resp, "count": len(resp)}
    except Exception as e:
        logger.error(f"the fetch_grouped api call failed with this error: {e}")


@app.get("/fetch_items/wish_mapping")
async def fetch_wish_mapping(
    request: Request,
    sortOrder: Optional[str] = Query(None),
    skip: Optional[int] = Query(None),
    limit: Optional[int] = Query(None),
):
    """ """
    sortOrder = sortOrder.lower() if sortOrder else sortOrder
    logger.info(f"""fetch_items: sortOrder={sortOrder}, skip={skip}, limit={limit}""")

    try:
        if skip and skip < 0:
            skip = 0

        if limit and limit < 0:
            limit = 0

        pool = request.app.state.pool
        rows = []
        async with pool.acquire() as con:
            rows = []

        item_list = [
            {
                "ean": row["ean"],
                "text": row["item_name"],
                "subgroups": row["subgroups"] or "",
                "classname": row["class"] or "",
                "count": row["count"],
                "perish_dates": convert_timestamps_to_dates(row["timestamps"]),
                "imageUrl": row["image_url"]
                or "http://boldo.ddns.net/none_available.webp",
                "tags": row["tags"],
            }
            for row in rows
        ]
        logger.info(f"fetch_items returned {len(item_list)} items")

        return {"items": item_list, "count": len(item_list)}

    except Exception as e:
        logger.error(f"fetch_items error: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="Failed to fetch items")


@app.get("/fetch_items")
async def fetch_items(
    request: Request,
    subgroups: Optional[str] = Query(None),
    classnames: Optional[str] = Query(None),
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
    sortOrder = sortOrder.lower() if sortOrder else sortOrder
    logger.info(
        f"""fetch_items: subgroups={subgroups}, classnames={classnames}, only_wish_list={only_wish_list},
            sortOrder={sortOrder}, searchQuery={searchQuery}, skip={skip}, limit={limit}"""
    )

    startingTime = datetime.datetime.now()
    try:
        if skip and skip < 0:
            skip = 0

        if limit and limit < 0:
            limit = 0

        query, params = build_fetch_query(
            subgroups,
            classnames,
            only_wish_list,
            sortOrder=sortOrder,
            skip=skip,
            limit=limit,
            include_tags=True,
            searchQuery=searchQuery
        )
        
        logger.info(f"time it took to get the query + params: {datetime.datetime.now() - startingTime}")
        
        rows = await request.app.state.db.fetch_with_retry(query, *params)

        item_list = [
            {
                "ean": row["ean"],
                "text": row["item_name"],
                "subgroups": row["subgroups"] or "",
                "classname": row["class"] or "",
                "count": row["count"],
                "perish_dates": convert_timestamps_to_dates(row["timestamps"]),
                "imageUrl": row["image_url"]
                or "http://boldo.ddns.net/none_available.webp",
                "tags": row["tags"],
            }
            for row in rows
        ]
        logger.info(f"fetch_items returned {len(item_list)} items")
        logger.info(f"time it took to get to the return: {datetime.datetime.now() - startingTime}")

        return {"items": item_list, "count": len(item_list)}

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


def normalizeSeparators(s: str) -> str:
    return re.sub(r"[_\-/·,]+", " ", s)


@app.get("/get_supermarkets_close")
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

    # overpass_url = "https://overpass-api.de/api/interpreter"
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


@app.post("/add_fetched_items")
async def addFetchedItems(request: Request, body: AddFetchedItems):
    try:
        pool = request.app.state.pool
        async with pool.acquire() as con:
            values = []
            for item in body.items:
                # Convert DD.MM.YYYY back to ISO for DB consistency if needed
                # If they are already ISO, json.dumps(item.perish_dates) is fine
                values.append(
                    (
                        str(item.ean),
                        item.text,
                        item.classname or "",
                        item.subgroups or "",
                        item.count,
                        json.dumps(item.perish_dates or []),
                        item.imageUrl or "",
                    )
                )

            await con.executemany(
                """
                INSERT INTO item_list 
                (ean, item_name, class, subgroups, count, timestamps, image_url)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (ean, item_name) 
                DO UPDATE SET 
                    count = EXCLUDED.count,
                    timestamps = EXCLUDED.timestamps,
                    class = EXCLUDED.class,
                    subgroups = EXCLUDED.subgroups,
                    image_url = EXCLUDED.image_url
                """,
                values,
            )

        return {"message": f"Synced {len(values)} items", "status": "success"}

    except Exception as e:
        logger.error(f"addFetchedItems failed: {e}")
        return {"done": False, "error": str(e)}


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


def shortenWithTable(itemName: str) -> str:
    itemName = normalizeSeparators(itemName.lower()).strip()

    # remove multi-word phrases (longest first!)
    for phrase in sorted(PHRASE_STRIP, key=len, reverse=True):
        itemName = itemName.replace(phrase, " ")

    # split on space and replace words according to lookup table
    tokens = []
    for word in itemName.split():
        tokens.append(WORD_STRIP.get(word, word))

    return " ".join(tokens).strip()


@app.get("/shorten_item_names")
async def shortenNames(request: Request, useBatch: bool = True):
    try:
        rows = await request.app.state.db.fetch_with_retry(
            "SELECT DISTINCT item_name, class, categories FROM item_list"
        )

        original_names = [
            row["item_name"]
            for row in rows
            if row["class"] == "" and row["item_name"].lower() not in ("", "none")
        ]

        categories = [row["categories"] for row in rows]

        shortened_deterministic = [shortenWithTable(name) for name in original_names]

        classified = classify_shortened_names(
            shortened_deterministic, categories, useBatch=useBatch
        )

        updated_count = 0
        for orig, cls in zip(original_names, classified):
            if cls:
                await request.app.state.db.execute_with_retry(
                    "UPDATE item_list SET class = $1 WHERE item_name = $2",
                    cls,
                    orig,
                )
                updated_count += 1

        logger.info(
            f"Updated {updated_count} item names out of {len(original_names)} empty entries"
        )

        return {
            "done": True,
            "updated": updated_count,
            "total_empty": len(original_names),
        }

    except Exception as e:
        logger.error(f"Failed while shortening item names: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}


async def mapItemToWishDaemon(pool: asyncpg.Pool, waitingTime: float = 60.0):
    from transcription.wishMapperClass import WishMapper

    try:
        await asyncio.sleep(waitingTime)
        logger.info(
            f"started mapItemToWishDaemon function after waiting time: {waitingTime}"
        )
        async with pool.acquire() as con:
            rows_items = await con.fetch(
                "SELECT DISTINCT item_name FROM item_list WHERE iswished IS NULL and mapped_wish = ''"
            )

            rows_wished = await con.fetch(
                "SELECT DISTINCT item_name FROM item_list where iswished = 'true' "
            )

            item_names = [row["item_name"] for row in rows_items]
            wished_items = [row["item_name"] for row in rows_wished]

        if not item_names:
            logger.info("mapItemToWishDaemon: nothing to map")
            return {"done": True, "updated": 0}

        mapper = WishMapper()
        try:
            updated_count = 0
            async with pool.acquire() as con:
                for item_name in item_names:
                    mapped: str = mapper.mapWishItem(item_name, wished_items)
                    await con.execute(
                        "UPDATE item_list SET mapped_wish = $1 WHERE item_name = $2",
                        mapped,
                        item_name,
                    )
                    updated_count += 1
        finally:
            pass

        logger.info(
            f"Updated {updated_count} item names out of {len(wished_items)} wish items, with length(item_names) = {len(item_names)}"
        )
        return {
            "done": True,
            "updated": updated_count,
        }

    except Exception as e:
        logger.error(f"Daemon for item wish mapping failed: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}


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
        await rescanCategoriesProcess(pool=pool)  # fill up categories if possible first
        async with pool.acquire() as con:
            rows = await con.fetch(
                "SELECT DISTINCT item_name, class, categories FROM item_list where not class = 'none' "
            )

            original_names = [
                row["item_name"]
                for row in rows
                if row["class"] == "" and row["item_name"].lower() not in ("", "none")
            ]

            shortened_deterministic = [
                shortenWithTable(name) for name in original_names
            ]

            categories = [row["categories"] for row in rows]

            updated_count = 0
            if original_names:
                shortened_deterministic = [
                    shortenWithTable(name) for name in original_names
                ]

                categories = [row["categories"] for row in rows]

                classified = classify_shortened_names(
                    shortened_deterministic, categories, useBatch=useBatch
                )

                for orig, cls in zip(original_names, classified):
                    if cls:
                        await con.execute(
                            "UPDATE item_list SET class = $1 WHERE item_name = $2",
                            cls,
                            orig,
                        )
                        updated_count += 1

            logger.info(
                f"Updated {updated_count} item names out of {len(original_names)} empty entries"
            )
            await asyncio.sleep(waitingTime)

            return {
                "done": True,
                "updated": updated_count,
                "total_empty": len(original_names),
            }

    except Exception as e:
        logger.error(f"Daemon for item name shortening failed: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}


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
                    "select ean, item_name, class, categories from item_list where tags = '' "
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

                for item in itemsToProcess:
                    try:
                        itemName = item["item_name"]
                        tagsDict: dict[str, str] = tagMapping[itemName]
                        # New format: just the category ID (e.g., "milk", "bread")
                        tags: str = tagsDict["base"]

                        await con.execute(
                            "update item_list set tags = $1 where item_name = $2 ",
                            tags,
                            itemName,
                        )
                        updatedCount += 1

                    except Exception as e:
                        raise Exception(
                            f"got an error for this tags dict: {tagsDict} with this being the error: {e}"
                        )

                # logger.info(f"Updated {updatedCount} tag assignments out of {len(itemsToProcess)} empty entries")

            """return {
                "done": True,
                "updated": updatedCount,
                "total_empty": len(itemsToProcess),
            }"""

        except Exception as e:
            logger.error(f"Daemon for tag assignment failed: {e}")
            logger.error(traceback.format_exc())
            return {"done": False, "error": str(e)}


async def assignShorthandNameToTags(pool: asyncpg.Pool, waitingTime: float = 40.0):
    updatedCount = 0
    logger.info("started assignShorthandNameToTags")

    try:
        while True:
            await asyncio.sleep(waitingTime)
            logger.info(
                f"started assignShorthandNameToTags funtion after wating time: {waitingTime}"
            )
            try:
                async with pool.acquire() as con:
                    # Optimized query - avoid TRIM in WHERE clause
                    rows = await con.fetch("""
                        SELECT DISTINCT il.tags as original_tags
                        FROM item_list il
                        WHERE il.tags IS NOT NULL 
                          AND il.tags != ''
                          AND il.tags NOT IN (
                              SELECT tags FROM tagging_to_name
                          );
                    """)

                    logger.info(f"Fetched {len(rows)} rows to process")

                    if not rows:
                        logger.info("No tags to process")
                    else:
                        tagsToInferList: list[str] = [
                            row["original_tags"].strip() for row in rows
                        ]
                        # Filter out empty strings after trim
                        tagsToInferList = [t for t in tagsToInferList if t]

                        if not tagsToInferList:
                            logger.info("No valid tags after filtering")
                        else:
                            tagToNameMapping: dict[str, str] | None = (
                                classifier.tagToNameBatch(tagsToInferList)
                            )

                            if tagToNameMapping:
                                for tag, name in tagToNameMapping.items():
                                    await con.execute(
                                        """INSERT INTO tagging_to_name (tags, inferred_name) 
                                           VALUES ($1, $2) 
                                           ON CONFLICT (tags) DO NOTHING""",
                                        tag,
                                        name,
                                    )
                                    updatedCount += 1

                            logger.info(
                                f"Assigned {updatedCount} short names for tags total"
                            )

            except asyncio.CancelledError:
                logger.info("assignShorthandNameToTags received cancellation signal")
                raise
            except asyncio.TimeoutError:
                logger.error(
                    "Query timeout in assignShorthandNameToTags - table might be too large or indexes missing"
                )
                await asyncio.sleep(waitingTime)
            except Exception as e:
                logger.error(f"Error in assignShorthandNameToTags: {e}")
                logger.error(traceback.format_exc())
                await asyncio.sleep(waitingTime)

    except asyncio.CancelledError:
        logger.info("assignShorthandNameToTags shutting down gracefully")
    finally:
        logger.info(
            f"assignShorthandNameToTags finished with {updatedCount} total updates"
        )


async def shorten_item_name_task(pool: asyncpg.Pool, item_name: str):
    """Background task to shorten a specific item name"""
    try:
        async with pool.acquire() as con:
            row = await con.fetchrow(
                "SELECT class, categories FROM item_list WHERE item_name = $1 AND class = '' LIMIT 1",
                item_name,
            )
            if row and row["class"] == "" and item_name.lower() not in ["", "none"]:
                stripped_name = shortenWithTable(item_name)
                shortened_name = classifier.shortenText(
                    stripped_name, row["categories"]
                )
                if shortened_name:
                    await con.execute(
                        "UPDATE item_list SET class = $1 WHERE item_name = $2",
                        shortened_name,
                        item_name,
                    )
                    logger.info(
                        f"Background task: Shortened item name '{item_name}' to '{shortened_name}'"
                    )
                else:
                    await con.execute(
                        "UPDATE item_list SET class = $1 WHERE item_name = $2",
                        "none",
                        item_name,
                    )
                    logger.info(
                        f"Background task: Shortened item name '{item_name}' to 'none' "
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
                "select tags, inferred_name from tagging_to_name where tags in ($1) ",
                tuple(tagsList),
            )

            for row in rows:
                tags = row["tags"]
                inferred_name = row["inferred_name"]

                tagsList.remove(tags)
                tagNameMapping[tags] = inferred_name

            if not useAi:
                for tag in tagsList:
                    processedName = processTagRuleBased(tag)

                    row = await con.fetch(
                        "select tags from tagging_to_name where tags = $1 ", tag
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


async def resetTagsAsignment(pool: asyncpg.Pool):
    try:
        await pool.fetch("update item_list set tags = '' where not tags = '' ")

    except Exception as _:
        logger.error("the resetTagsAsignment failed")


async def rescanCategoriesProcess(pool: asyncpg.Pool):
    try:
        rows = await pool.fetch("select distinct(ean), categories from item_list")
        eansToMod = []

        for row in rows:
            if row["categories"] == "" and row["ean"] not in ["-1", "0", "1"]:
                eansToMod.append(row["ean"])

        updated_count = 0
        for ean in eansToMod:
            categories = getCategories(ean)
            if categories:
                await pool.fetch(
                    "UPDATE item_list SET categories = $1 WHERE ean = $2",
                    str(categories),
                    ean,
                )
                updated_count += 1
            else:
                await pool.fetch(
                    "UPDATE item_list SET categories = $1 WHERE ean = $2", "[]", ean
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


@app.get("/rescan_for_categories")
async def rescanCategories(request: Request):
    """Rescan all items with empty categories and fetch them from OpenFoodFacts"""
    try:
        rows = await request.app.state.db.fetch_with_retry(
            "select distinct(ean), categories from item_list"
        )
        eansToMod = []

        for row in rows:
            if row["categories"] == "" and row["ean"] not in ["-1", "0", "1"]:
                eansToMod.append(row["ean"])

        updated_count = 0
        for ean in eansToMod:
            categories = getCategories(ean)
            if categories:
                await request.app.state.db.execute_with_retry(
                    "UPDATE item_list SET categories = $1 WHERE ean = $2",
                    categories,
                    ean,
                )
                updated_count += 1
            else:
                await request.app.state.db.execute_with_retry(
                    "UPDATE item_list SET categories = $1 WHERE ean = $2", "[]", ean
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
        logger.error(f"Failed while rescanning categories in rescanCategories: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}
        

async def resetDeprecatedImageUrls(pool: asyncpg.Pool, deprecationDays: int = 30) -> list[str]:
    async with pool.acquire() as con:

        items_to_update = await con.fetch(
            """
            SELECT ean
            FROM item_list
            WHERE (checked_last < NOW() - $1 * INTERVAL '1 day'
                   OR image_url = '')
              AND ean NOT IN ('-1','0','1')
            """,
            deprecationDays
        )

        await con.execute(
            """
            UPDATE item_list
            SET checked_last = NOW()
            WHERE (checked_last < NOW() - $1 * INTERVAL '1 day'
                   OR image_url = '')
              AND ean NOT IN ('-1','0','1')
            """,
            deprecationDays
        )

        return [item["ean"] for item in items_to_update]
    

async def rescanImageUrls(pool: asyncpg.Pool):
    try:
        eansToMod = await resetDeprecatedImageUrls(pool, deprecationDays=30)
        if not eansToMod:
            logger.info("rescanImageUrls: nothing to update")
            return {"done": True, "updated": 0, "total_empty": 0}

        updated_count = 0
        # Single shared client for all requests in this scan pass
        async with httpx.AsyncClient(
            headers={"User-Agent": "grocery-list-app/1.0"},
            timeout=httpx.Timeout(5.0),
        ) as client:
            async with pool.acquire() as con:
                for ean in eansToMod:
                    image_url = await getImageUrlAsync(client, ean, delay=1)
                    if image_url:
                        await con.execute(
                            "UPDATE item_list SET image_url = $1 WHERE ean = $2",
                            image_url, ean,
                        )
                        updated_count += 1

        logger.info(f"Updated {updated_count} image URLs out of {len(eansToMod)} entries")
        return {"done": True, "updated": updated_count, "total_empty": len(eansToMod)}

    except Exception as e:
        logger.error(f"Failed while rescanning image URLs: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}

@app.get("/migrate_tags")
async def migrate_tags(request: Request):
    """
    Migrate old 3-part tags (e.g., 'fruit spread, strawberry, jarred')
    to new single-category format (e.g., 'jam').

    Re-classifies all items with old-format tags using keyword matching
    (fast, deterministic) and updates the tagging_to_name table.
    """
    try:
        async with request.app.state.pool.acquire() as con:
            # Find items with old-format tags (contain commas = old format)
            rows = await con.fetch(
                "SELECT DISTINCT item_name, class, categories, tags FROM item_list "
                "WHERE tags != '' AND tags LIKE '%,%'"
            )

            if not rows:
                return {
                    "done": True,
                    "message": "No old-format tags found",
                    "migrated": 0,
                }

            logger.info(
                f"Migrating {len(rows)} items from old tag format to new categories"
            )

            items_to_process = [
                {
                    "item_name": row["item_name"],
                    "shortened_name": row["class"] or "",
                    "categories": row["categories"] or "",
                }
                for row in rows
            ]

            tag_mapping = classifier.tagAssignmentBatch(items=items_to_process)

            migrated = 0
            for item in items_to_process:
                name = item["item_name"]
                if name in tag_mapping:
                    new_tag = tag_mapping[name]["base"]
                    await con.execute(
                        "UPDATE item_list SET tags = $1 WHERE item_name = $2",
                        new_tag,
                        name,
                    )
                    migrated += 1

            # Clean up orphaned tagging_to_name entries
            await con.execute("""
                DELETE FROM tagging_to_name
                WHERE tags NOT IN (SELECT DISTINCT tags FROM item_list WHERE tags != '')
            """)

            logger.info(f"Migration complete: {migrated}/{len(rows)} items migrated")
            return {"done": True, "migrated": migrated, "total_old_format": len(rows)}

    except Exception as e:
        logger.error(f"Tag migration failed: {e}")
        logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}


@app.post("/add_ean_to_list/")
async def add_ean_to_list(
    request: Request, body: AddEanRequest, background_tasks: BackgroundTasks
):
    if not body.ean and not body.item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")

    count_delta = safe_int(body.count, 1)
    subgroups = sanitize_string(body.subgroups, "none")
    wish_list = validate_wish_list(body.wish_list)

    try:
        # Resolve identity AND check existence in the same connection
        async with request.app.state.pool.acquire() as con:
            resolved_ean, resolved_item_name = await resolve_item_identity(
                con, body.ean, body.item_name
            )
            existing = await con.fetchrow(
                "SELECT 1 FROM item_list WHERE item_name = $1", resolved_item_name
            )

        # Now fetch image outside any connection/transaction
        image_url = ""
        if not existing and resolved_ean not in ("0", "-1", "1"):
            image_url = await getImageUrlAsync(
                request.app.state.http_client, resolved_ean
            )

        # Open a fresh connection for the actual write
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                operation = await perform_item_operation(
                    con,
                    resolved_item_name,
                    resolved_ean,
                    count_delta,
                    subgroups,
                    wish_list,
                    image_url=image_url,
                )

                is_known = resolved_item_name != "none" and resolved_ean not in (
                    "0",
                    "-1",
                )

                if operation == "created" and resolved_item_name:
                    background_tasks.add_task(
                        shorten_item_name_task,
                        request.app.state.pool,
                        resolved_item_name,
                    )

                return {
                    "ean": resolved_ean,
                    "product_name": resolved_item_name,
                    "done": is_known,
                    "subgroups": subgroups,
                    "known_to_db": is_known,
                    "operation": operation,
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
    is_wish_list: Optional[str] = Query(None),
):
    """
    Enhanced manual EAN addition with comprehensive error handling

    @deprecated Use /api/items/update instead for better performance and consistency
    This endpoint is maintained for backwards compatibility only.
    """
    start_time = time.time()
    op_id = f"{int(time.time() * 1000)}"

    logger.info(
        f"[{op_id}] add_ean_manual: ean={ean}, item_name={item_name}, count={count}"
    )

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
                resolved_ean, resolved_item_name = await resolve_item_identity(
                    con, ean if ean != "0" else None, item_name
                )

                # Check for new EAN entry (special case for manual entry)
                if resolved_item_name and resolved_ean != "0":
                    existing_by_ean = await con.fetchrow(
                        "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1",
                        resolved_ean,
                    )

                    if not existing_by_ean:
                        operation = await perform_item_operation(
                            con,
                            resolved_item_name,
                            resolved_ean,
                            count_delta,
                            subgroups,
                            is_wish_list,
                        )
                        execution_time = time.time() - start_time

                        return {
                            "ean": resolved_ean,
                            "product_name": resolved_item_name,
                            "done": True,
                            "subgroups": subgroups,
                            "operation": "created_new",
                            "execution_time": execution_time,
                        }

                # Perform standard operation
                operation = await perform_item_operation(
                    con,
                    resolved_item_name,
                    resolved_ean,
                    count_delta,
                    subgroups,
                    is_wish_list,
                )

                execution_time = time.time() - start_time
                logger.info(
                    f"[{op_id}] Completed in {execution_time:.2f}s, operation={operation}"
                )

                return {
                    "ean": resolved_ean,
                    "product_name": resolved_item_name,
                    "done": True,
                    "subgroups": subgroups,
                    "operation": operation,
                    "execution_time": execution_time,
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


@app.post("/transcribe")
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
        purge_folder("uploads")


'''
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
            timeout=None,
        )
        return StreamingResponse(
            resp.aiter_raw(), status_code=resp.status_code, headers=resp.headers
        )'''


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
    status["whisper"] = (
        "enabled"
        if (Config.ENABLE_WHISPER_MODEL_LOCAL or Config.ENABLE_WHISPER_MODEL_CLOUD)
        else "disabled"
    )
    status["ml_model"] = "loaded" if request.app.state.net else "disabled"

    return status


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================
if __name__ == "__main__":

    cpuCount = os.cpu_count()
    workerNumber = 1
    if cpuCount:
        workerNumber = min(cpuCount,4)
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
