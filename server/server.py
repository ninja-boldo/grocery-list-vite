import os
from pathlib import Path
import shlex
import traceback
import urllib.parse

import httpx
import requests
os.environ['KMP_DUPLICATE_LIB_OK']='True'

import datetime
import json
import shutil
from typing import Optional, Union
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, Query, Request, UploadFile, HTTPException
import uvicorn

from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger  # noqa: F401

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

# ============================================================================
# MEMORY OPTIMIZATION SETTINGS - Toggle features here
# ============================================================================
ENABLE_ML_MODEL = False              # Set to False to disable food classifier model
ENABLE_WHISPER_MODEL_LOCAL = False    # Set to False to disable local voice transcription
ENABLE_WHISPER_MODEL_CLOUD = True    # Set to False to disable cloud voice trainscription
ENABLE_LOKI_LOGGING = True           # Set to False to disable Loki remote logging
ENABLE_PROMETHEUS = True             # Set to False to disable Prometheus metrics
ENABLE_FILE_LOGGING = True           # Set to False to use only console logging

# Database pool settings (reduced for lower memory usage)
DB_POOL_MIN_SIZE = 1            # Reduced from 2
DB_POOL_MAX_SIZE = 5            # Reduced from 10

# Cache settings
LRU_CACHE_SIZE = 20             

# Logging settings
LOG_FILE_MAX_SIZE = 5*1024*1024 
LOG_FILE_BACKUP_COUNT = 2       
# ============================================================================

cloud_transcription = False
if ENABLE_WHISPER_MODEL_LOCAL or ENABLE_WHISPER_MODEL_CLOUD: 
    from transcription.transcript import init_whisper, transcribe
    from transcription import classifier
    if ENABLE_WHISPER_MODEL_CLOUD and ENABLE_WHISPER_MODEL_LOCAL:
        raise Exception("ENABLE_WHISPER_MODEL_LOCAL and ENABLE_WHISPER_MODEL_CLOUD cant be set at the same time")

    
if ENABLE_ML_MODEL:
    import torch # type: ignore
    import food_classifier.main as food_classifier
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu') 
    
if os.getenv('RUNNING_IN_CONTAINER'):
    DATABASE_URL = "postgresql://postgres:postgres@postgres-db:5432/maindb"
    CSV_FILE = "/app/openfoodfacts.csv"
else:
    DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/maindb"
    CSV_FILE = "/Users/bennetjollenbeck/Desktop/programming/web/react/family_projects/grocery-list2/server/openfoodfacts.csv"

api_key = "one-rgs iodesftheontisissihdebeten thncstthinciree wholeswedissh-ek-"

scheduler = AsyncIOScheduler()



logger = logging.getLogger("fastapi-logger")
logger.handlers.clear()

# [UNCHANGED] _parse_db_url function
def _parse_db_url(db_url: str):
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

# [UNCHANGED] _run_psql_command function
async def _run_psql_command(cmd_args: list[str], env: Optional[dict] = None):
    proc = await asyncio.create_subprocess_exec(
        *cmd_args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    out, err = await proc.communicate()
    return proc.returncode, out.decode(errors="ignore"), err.decode(errors="ignore")

# [UNCHANGED] _psql_restore_file function
async def _psql_restore_file(dump_path: str, dbname: str | None, user: str | None, host: Optional[str], port: Optional[str], env: dict):
    if dbname is None:
        raise Exception("dbname parameter cant be none but is in this")
    if user is None:
        raise Exception("user parameter cant be none but is in this")
    
    cmd = ["psql", "-U", user, "-d", dbname, "-f", dump_path]
    if host:
        cmd[1:1] = ["-h", host]
    if port:
        cmd[1:1] = ["-p", str(port)]
    logger.info("Restoring SQL dump via psql: %s", dump_path)
    return await _run_psql_command(cmd, env=env)

# [UNCHANGED] _psql_copy_csv function
async def _psql_copy_csv(csv_path: str, dbname: str, user: str, host: Optional[str], port: Optional[str], env: dict):
    copy_cmd = (
        r"\copy food(code,product_name,quantity,packaging,brands_en,categories,ingredients_text,energy_kcal_100g) "
        f"FROM {shlex.quote(csv_path)} WITH (FORMAT csv, HEADER true)"
    )
    cmd = ["psql", "-U", user, "-d", dbname, "-c", copy_cmd]
    if host:
        cmd[1:1] = ["-h", host]
    if port:
        cmd[1:1] = ["-p", str(port)]
    logger.info("Loading CSV via psql \\copy: %s", csv_path)
    return await _run_psql_command(cmd, env=env)

def get_path(level: int = 0) -> str:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if level < 0:
        parts = script_dir.split(os.sep)

        parts = parts[:(len(parts) + level)]
        script_dir = os.sep.join(parts) or os.sep
    return script_dir

async def init_database(pool, dump_path: str = os.environ.get("PG_DUMP", "maindb.sql"), csv_path: str = CSV_FILE):
    """Initialize DB schema, attempt to restore dump_path (plain SQL) if present, then
    ensure 'food' has rows — fall back to csv_path via psql \\copy if still empty."""
    dump_path_variants = [f"/app/{dump_path}", f"/server/{dump_path}", f"{get_path(level=0)}/{dump_path}",
                          f"{get_path(level=-1)}/{dump_path}", f"{get_path(level=-2)}/{dump_path}"]
    user, host, port, dbname, env = _parse_db_url(DATABASE_URL)
    try:
        async with pool.acquire() as con:
            await con.execute("""
                CREATE TABLE IF NOT EXISTS food (
                    code TEXT, product_name TEXT, quantity TEXT, packaging TEXT,
                    brands_en TEXT, categories TEXT, ingredients_text TEXT, energy_kcal_100g TEXT
                );
            """)
            await con.execute("""
                CREATE TABLE IF NOT EXISTS item_list (
                    id SERIAL PRIMARY KEY, ean TEXT, item_name TEXT, subgroups TEXT, class TEXT,
                    count INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    timestamps JSONB DEFAULT '[]'::jsonb
                );
            """)
            await con.execute("ALTER TABLE item_list ADD COLUMN IF NOT EXISTS timestamps JSONB DEFAULT '[]'::jsonb;")
            idxs = [
                ("idx_item_list_subgroups", "item_list(subgroups)"),
                ("idx_item_list_class", "item_list(class)"),
                ("idx_item_list_ean", "item_list(ean)"),
                ("idx_item_list_item_name", "item_list(item_name)"),
                ("idx_item_list_subgroups_class", "item_list(subgroups, class)"),
                ("idx_food_code", "food(code)"),
                ("idx_food_product_name", "food(product_name)"),
            ]
            for name, target in idxs:
                await con.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {target};")
            exists = await con.fetchval(
                "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename=$1)", "food"
            )
            count = 0
            if exists:
                count = await con.fetchval("SELECT COUNT(*) FROM food;")
            logger.info("Initial food row count: %s", count)
        print(f"trying to get to dump file with path: {dump_path}")
        loaded = False
        idx = 0
        while not loaded and idx < len(dump_path_variants) - 1:
            if os.path.exists(dump_path) and count == 0:
                logger.info("Found dump file at %s — attempting restore", dump_path)
                loaded = True
                rc, out, err = await _psql_restore_file(dump_path, dbname, user, host, port, env)
                if rc != 0:
                    logger.error("psql restore failed (rc=%s): %s", rc, err.strip())
                else:
                    logger.info("psql restore succeeded.")
            else:
                logger.info("Dump file not found at %s", dump_path)
                dump_path = dump_path_variants[idx]
                idx += 1
            
        async with pool.acquire() as con:
            exists_after = await con.fetchval(
                "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename=$1)", "food"
            )
            count_after = 0
            if exists_after:
                count_after = await con.fetchval("SELECT COUNT(*) FROM food;")
            logger.info("Food count after restore attempt: %s", count_after)
        if count_after == 0 and os.path.exists(csv_path):
            logger.info("Food empty after restore — attempting CSV fallback: %s", csv_path)
            rc, out, err = await _psql_copy_csv(csv_path, dbname, user, host, port, env)
            if rc != 0:
                logger.error("psql \\copy failed (rc=%s): %s", rc, err.strip())
            else:
                logger.info("CSV \\copy completed successfully.")
        elif count_after == 0:
            logger.warning("Food table empty and no CSV available at %s", csv_path)
        async with pool.acquire() as con:
            final_exists = await con.fetchval(
                "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename=$1)", "food"
            )
            final_count = 0
            if final_exists:
                final_count = await con.fetchval("SELECT COUNT(*) FROM food;")
            tables = await con.fetch("SELECT tablename FROM pg_tables WHERE schemaname='public';")
            logger.info("Final food count: %s", final_count)
            logger.info("Available tables: %s", [t["tablename"] for t in tables])
    except Exception:
        logger.exception("Failed to initialize database schema")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        # Create async connection pool with REDUCED SIZE for memory efficiency
        app.state.pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=DB_POOL_MIN_SIZE,
            max_size=DB_POOL_MAX_SIZE,
            command_timeout=30,
            server_settings={'jit': 'off'}
        )
        
        # Initialize database schema
        await init_database(app.state.pool)
        
        # Preload whisper model (CONDITIONAL)
        if ENABLE_WHISPER_MODEL_LOCAL:
            try:
                app.state.whisper = init_whisper(cloud=False)
                logger.info("Whisper model loaded successfully")
            except Exception as e:
                logger.error(f"Whisper model initialization failed: {e}")
                app.state.whisper = None
        else:
            app.state.whisper = None
            logger.info("Whisper model disabled (ENABLE_WHISPER_MODEL=False)")
            
        # Load ML model (CONDITIONAL)
        if ENABLE_ML_MODEL:
            try:
                net = food_classifier.create_net(num_classes=206)
                model_folder = food_classifier.get_relative_path()
                model_path = os.path.join(model_folder, "food_classifier_resnet50.pth")
                
                if os.path.exists(model_path):
                    net.load_state_dict(torch.load(model_path, weights_only=True))
                    net = net.to(device)
                    app.state.net = net 
                    logger.info("ML model loaded successfully")
                else:
                    logger.warning(f"Model file not found: {model_path}")
                    app.state.net = None
            except Exception as e:
                logger.error(f"Failed to load ML model: {e}")
                app.state.net = None
        else:
            app.state.net = None
            logger.info("ML model disabled (ENABLE_ML_MODEL=False)")

        yield

    finally:
        if hasattr(app.state, 'pool'):
            await app.state.pool.close()
            logger.info("Database pool closed")

app = FastAPI(lifespan=lifespan, debug=False)

# Conditionally enable Prometheus
if ENABLE_PROMETHEUS:
    Instrumentator().instrument(app).expose(app)
    logger.info("Prometheus metrics enabled")


class SafeLokiHandler(LokiHandler):
    """A Loki handler that fails gracefully when the server is unavailable"""
    
    def __init__(self, *args, **kwargs):
        self.fallback_handler = logging.StreamHandler()
        self.fallback_handler.setLevel(logging.INFO)
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        self.fallback_handler.setFormatter(formatter)
        super().__init__(*args, **kwargs)
    
    def emit(self, record):
        try:
            super().emit(record)
        except (requests.exceptions.ConnectionError, 
                requests.exceptions.Timeout,
                requests.RequestException,
                Exception):
            self.fallback_handler.emit(record)

def setup_logging():
    """Setup robust logging with CONDITIONAL Loki and file logging for memory efficiency"""
    
    # Create log queue for async processing
    log_queue = queue.Queue()
    
    # Setup console handler (ALWAYS ENABLED)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    console_handler.setFormatter(formatter)
    
    # Start with console handler
    handlers = []
    handlers.append(console_handler)
    handler_description = "Console only"
    
    # CONDITIONALLY add file handler
    if ENABLE_FILE_LOGGING:
        file_handler = RotatingFileHandler(
            'server.log', 
            maxBytes=LOG_FILE_MAX_SIZE,
            backupCount=LOG_FILE_BACKUP_COUNT
        )
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(formatter)
        handlers.append(file_handler)
        handler_description = "Console+File"
    
    # CONDITIONALLY test Loki connection and add handler if available
    if ENABLE_LOKI_LOGGING:
        try:
            test_response = requests.get("http://192.168.1.13:3100/ready", timeout=2)
            if test_response.status_code == 200:
                loki_handler = SafeLokiHandler(
                    url="http://192.168.1.13:3100/loki/api/v1/push",
                    tags={"application": "grocery-list", "environment": "development"},
                    version="1",
                )
                handlers.append(loki_handler)
                handler_description += "+Loki"
                print("✓ Connected to Loki logging server")
            else:
                print("⚠ Loki server not ready, using fallback logging")
        except Exception as e:
            print(f"⚠ Could not connect to Loki server ({e}), using fallback logging")
    else:
        print("ℹ Loki logging disabled (ENABLE_LOKI_LOGGING=False)")
    
    # Create queue listener with verified handlers
    queue_listener = QueueListener(log_queue, *handlers, respect_handler_level=True)
    
    # Clear any existing handlers and setup new logger
    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    

    
    queue_handler = QueueHandler(log_queue)
    logger.addHandler(queue_handler)
    logger.setLevel(logging.INFO)
    
    # Start queue listener
    queue_listener.start()
    
    print(f"✓ Logging setup complete. Handlers: {len(handlers)} ({handler_description})")
    
    return queue_listener, logger

# Initialize logging
queue_listener, logger = setup_logging()


def cleanup_logging():
    if queue_listener:
        queue_listener.stop()

atexit.register(cleanup_logging)


BACKEND_URL = "http://192.168.1.165:3030"

# [UNCHANGED] proxy endpoint
@app.api_route("/transcribe/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy(request: Request, path: str):
    client = httpx.AsyncClient()
    url = f"{BACKEND_URL}/{path}"
    req_headers = dict(request.headers)
    body = await request.body()
    resp = await client.request(
        request.method, url, headers=req_headers, content=body, timeout=None
    )
    return StreamingResponse(resp.aiter_raw(), status_code=resp.status_code, headers=resp.headers)

# [UNCHANGED] CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins="*",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# [UNCHANGED] optimized_middleware
@app.middleware("http")
async def optimized_middleware(request: Request, call_next):
    if request.url.path == "/metrics":
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return PlainTextResponse("Unauthorized", status_code=401)
        token = auth_header.removeprefix("Bearer ").strip()
        if token != api_key:
            logger.warning("Unauthorized metrics access attempt")
            return PlainTextResponse("Unauthorized", status_code=401)
    try:
        start_time = time.time()
        response = await call_next(request)
        process_time = time.time() - start_time
        if process_time > 1.0 or (hasattr(response, "status_code") and response.status_code >= 400):
            logger.warning(
                f"Slow/Error request: {request.method} {request.url.path} - {process_time:.2f}s - Status: {getattr(response, 'status_code', 'unknown')}"
            )
        return response
    except Exception as e:
        logger.error(f"Unhandled exception on {request.method} {request.url.path}: {str(e)}")
        logger.error(f"Full traceback:\n{traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={
                "detail": f"Internal server error: {str(e)}",
                "path": str(request.url.path),
                "method": request.method,
            },
        )


# Cache for frequently accessed queries (REDUCED SIZE)
@lru_cache(maxsize=LRU_CACHE_SIZE)
def get_distinct_query(field: str) -> str:
    return f"SELECT DISTINCT {field} FROM item_list WHERE {field} != '' AND {field} IS NOT NULL ORDER BY {field}"

# [UNCHANGED] fetch_subgroups endpoint
@app.get("/fetch_subgroups")
async def fetch_subgroups(request: Request):
    try:
        async with request.app.state.pool.acquire() as con:
            subgroups = await con.fetch(get_distinct_query("subgroups"))
        return {"subgroups": [sg['subgroups'] for sg in subgroups]}
    except Exception as e:
        logger.error(f"Error fetching subgroups: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch subgroups")

# [UNCHANGED] fetch_classnames endpoint
@app.get("/fetch_classnames")
async def fetch_classnames(request: Request):
    try:
        async with request.app.state.pool.acquire() as con:
            classnames = await con.fetch(get_distinct_query("class"))
        return {"classnames": [cn['class'] for cn in classnames]}
    except Exception as e:
        logger.error(f"Error fetching classnames: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch classnames")

# [UNCHANGED] fetch_all_metadata endpoint
@app.get("/fetch_all_metadata")
async def fetch_all_metadata(request: Request):
    """Fetch subgroups and classnames in one request to reduce round trips"""
    try:
        async with request.app.state.pool.acquire() as con:
            subgroups_task = con.fetch(get_distinct_query("subgroups"))
            classnames_task = con.fetch(get_distinct_query("class"))
            subgroups_result, classnames_result = await asyncio.gather(
                subgroups_task, classnames_task
            )
            return {
                "subgroups": [sg['subgroups'] for sg in subgroups_result],
                "classnames": [cn['class'] for cn in classnames_result]
            }
    except Exception as e:
        logger.error(f"Error fetching metadata: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch metadata")


# [UNCHANGED] convert_to_dates function
def convert_to_dates(string: str, verbose: bool = False) -> str:
    arr = json.loads(string)
    new_arr = [d.date().isoformat() for d in (datetime.datetime.fromisoformat(t) for t in arr)]
    if verbose:
        print(f"this was the input: {string}")
        print(f"this has been returned: {json.dumps(new_arr)}")
    return json.dumps(new_arr)

# [UNCHANGED] fetch_items endpoint
@app.get("/fetch_items")
async def fetch_items(
    request: Request, 
    subgroups: Optional[str] = Query(None), 
    classnames: Optional[str] = Query(None),
    only_wish_list: Optional[str] = Query(None)
):
    logger.info(f"got fetch items request for these params: \n subgroups: {subgroups} classnames: {classnames} only_wish_list: {only_wish_list}")
    try:
        async with request.app.state.pool.acquire() as con:
            query, params = _build_fetch_query(subgroups, classnames, only_wish_list)
            logger.info(f"executing this query: {query}")
            items = await con.fetch(query, *params)
            logger.info(f"Query executed successfully, returned {len(items)} items")
            item_list = [( 
                item['ean'], item['item_name'], item['subgroups'], 
                item['class'], item['count'], convert_to_dates(item['timestamps']) 
            ) for item in items]
            return {"item_list": item_list}
    except Exception as e:
        logger.error(f"Error fetching items: {e}")
        logger.error(f"Full traceback:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to fetch items")


# [UNCHANGED] _build_fetch_query function
def _build_fetch_query(subgroups: Optional[str], classnames: Optional[str], only_wish_list: Optional[str]) -> tuple[str, list]:
    """Build SQL query and parameters based on filters."""
    base_query = """
        SELECT ean, item_name, subgroups, class, count, timestamps
        FROM item_list
    """
    conditions = []
    params = []
    if subgroups:
        conditions.append("subgroups = ${}".format(len(params) + 1))
        params.append(subgroups)
    if classnames:
        conditions.append("class = ${}".format(len(params) + 1))
        params.append(classnames)
    wish_list_condition = _get_wish_list_condition(only_wish_list, len(params))
    if wish_list_condition:
        conditions.append(wish_list_condition['condition'])
        params.extend(wish_list_condition['params'])
    where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
    order_clause = " ORDER BY item_name"
    limit_clause = " LIMIT 1000" if not any([subgroups, classnames, only_wish_list]) else ""
    query = base_query + where_clause + order_clause + limit_clause
    return query, params


# [UNCHANGED] _get_wish_list_condition function
def _get_wish_list_condition(only_wish_list: Optional[str], param_offset: int) -> Optional[dict]:
    """Generate wish list condition and parameters."""
    if not only_wish_list or only_wish_list not in ["true", "false"]:
        return None
    if only_wish_list == "true":
        return {
            'condition': f"iswished = ${param_offset + 1}",
            'params': ["true"]
        }
    else:
        return {
            'condition': "COALESCE(lower(iswished::text), '') <> 'true'",
            'params': []
        }
    
# [UNCHANGED] add_ean_to_list endpoint
@app.get("/add_ean_to_list/")
async def add_ean_to_list(
    request: Request,
    ean: Optional[str] = Query(None, min_length=8, max_length=14),
    subgroups: Optional[str] = Query(None),
    count: Optional[int] = Query(1),
    item_name: Optional[str] = Query(None),
    wish_list: Optional[str] = Query(None)
):
    if not ean and not item_name:
        raise HTTPException(status_code=400, detail="You must supply either ean or item_name")
    count = count or 1
    subgroups = subgroups or ""
    if wish_list:
        wish_list = str(wish_list.lower())
    else:
        print("no wish list supplied on endpoint /add_ean_to_list")
        logger.warning("no wish list supplied on endpoint /add_ean_to_list")
    if wish_list not in ["true", "false"] and wish_list:
        raise Exception(f"wish list seems to be something else than true or false: {wish_list}")
    elif not wish_list:
        raise Exception(f"wish list seems to be none/null: {wish_list}")
    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                if ean and not item_name:
                    result = await con.fetchrow(
                        "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                    )
                    if result:
                        item_name = result['item_name']
                    else:
                        result = await con.fetchrow(
                            "SELECT product_name FROM food WHERE code = $1 and iswished = $2 LIMIT 1", ean, wish_list
                        )
                        if result:
                            item_name = result['product_name']
                        else:
                            raise HTTPException(status_code=404, detail=f"Item not found for given EAN: {ean}")
                elif item_name and not ean:
                    result = await con.fetchrow(
                        "SELECT ean FROM item_list WHERE item_name = $1 LIMIT 1", item_name
                    )
                    ean = result['ean'] if result else "-1"
                result = await con.fetchrow(
                    "SELECT count, timestamps FROM item_list WHERE item_name = $1", item_name
                )
                current_time = datetime.datetime.now().isoformat()
                if not result:
                    timestamps = [current_time] * count if count > 0 else []
                    await con.execute(
                        """INSERT INTO item_list (ean, item_name, subgroups, class, count, timestamps, iswished) 
                           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                        ean, item_name, subgroups, "", count, json.dumps(timestamps), wish_list
                    )
                else:
                    existing_count = result['count']
                    existing_timestamps = json.loads(result['timestamps'] or '[]')
                    if count < 0:
                        items_to_remove = min(abs(count), existing_count)
                        remaining_timestamps = existing_timestamps[items_to_remove:]
                        new_count = existing_count - items_to_remove
                    else:
                        new_timestamps = [current_time] * count
                        remaining_timestamps = existing_timestamps + new_timestamps
                        new_count = existing_count + count
                    if new_count <= 0:
                        await con.execute(
                            "DELETE FROM item_list WHERE item_name = $1", item_name
                        )
                    else:
                        await con.execute(
                            "UPDATE item_list SET count = $1, timestamps = $2 WHERE item_name = $3",
                            new_count, json.dumps(remaining_timestamps), item_name
                        )
                product_result = await con.fetchrow(
                    "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
                )
                product_name = product_result['product_name'] if product_result else item_name
                return {
                    "ean": ean,
                    "product_name": product_name,
                    "done": True,
                    "subgroups": subgroups
                }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding EAN: {e}")
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
    Enhanced manual EAN addition with better error handling, performance, and logging
    """
    start_time = time.time()
    operation_id = f"{int(time.time() * 1000)}"  # Unique operation ID for tracking
    
    logger.info(f"[{operation_id}] Starting add_ean_manual with params: ean={ean}, item_name={item_name}, count={count}, subgroups={subgroups}, is_wish_list={is_wish_list}")
    #print(f"[{operation_id}] Starting add_ean_manual with params: ean={ean}, item_name={item_name}, count={count}, subgroups={subgroups}, is_wish_list={is_wish_list}")
    
    try:
        # Input validation and sanitization
        try:
            count = int(count) if count is not None else 1
        except (ValueError, TypeError) as e:
            logger.error(f"[{operation_id}] Invalid count parameter: {count}, error: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid count parameter: {count}")
        
        # Validate required parameters
        if not ean and not item_name:
            logger.error(f"[{operation_id}] Missing required parameters: both ean and item_name are None")
            raise HTTPException(status_code=400, detail="You must supply either ean or item_name")
        
        # Validate wish list parameter
        
        if is_wish_list:
            is_wish_list = str(is_wish_list).lower().strip()
            if is_wish_list not in ["true", "false"]:
                logger.error(f"[{operation_id}] Invalid is_wish_list parameter: {is_wish_list}")
                raise HTTPException(status_code=400, detail="is_wish_list must be 'true' or 'false'")
        else:
            is_wish_list = "false"  # Default value
        
        # Sanitize inputs
        subgroups = (subgroups or "").strip()
        ean = (ean or "0").strip()
        if item_name:
            item_name = item_name.strip()
        
        logger.info(f"[{operation_id}] Sanitized params: ean={ean}, item_name={item_name}, count={count}, subgroups={subgroups}, is_wish_list={is_wish_list}")

        # Database operations
        try:
            async with request.app.state.pool.acquire() as con:
                logger.debug(f"[{operation_id}] Acquired database connection")
                
                async with con.transaction():
                    logger.debug(f"[{operation_id}] Started database transaction")
                    
                    # Step 1: Resolve item_name from EAN if needed
                    if ean and ean != "0" and not item_name:
                        logger.debug(f"[{operation_id}] Resolving item_name from EAN: {ean}")
                        
                        # Try item_list first (more likely to have custom names)
                        result = await con.fetchrow(
                            "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                        )
                        
                        if result:
                            item_name = result['item_name']
                            logger.debug(f"[{operation_id}] Found item_name in item_list: {item_name}")
                        else:
                            # Fallback to food table
                            result = await con.fetchrow(
                                "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
                            )
                            if result:
                                item_name = result['product_name']
                                logger.debug(f"[{operation_id}] Found item_name in food table: {item_name}")
                            else:
                                logger.error(f"[{operation_id}] Item not found for EAN: {ean}")
                                raise HTTPException(
                                    status_code=404, 
                                    detail=f"Item not found for EAN: {ean}"
                                )

                    # Step 2: Resolve EAN from item_name if needed
                    elif item_name and (not ean or ean == "0"):
                        logger.debug(f"[{operation_id}] Resolving EAN from item_name: {item_name}")
                        
                        result = await con.fetchrow(
                            "SELECT ean FROM item_list WHERE item_name = $1 LIMIT 1", item_name
                        )
                        ean = result['ean'] if result else "0"
                        logger.debug(f"[{operation_id}] Resolved EAN: {ean}")
                    
                    # Step 3: Check if this is a new EAN entry that should be added to food table
                    if item_name and ean and ean != "0":
                        logger.debug(f"[{operation_id}] Checking if EAN exists in item_list: {ean}")
                        
                        result = await con.fetchrow(
                            "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                        )
                        
                        if not result:
                            logger.info(f"[{operation_id}] New EAN detected, creating new entry: ean={ean}, item_name={item_name}")
                            
                            current_time = datetime.datetime.now().isoformat()
                            timestamps = [current_time] * count if count > 0 else []
                            
                            try:
                                await con.execute(
                                    """INSERT INTO item_list 
                                       (ean, item_name, subgroups, class, count, timestamps, iswished) 
                                       VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                                    ean, item_name, subgroups, "", count, 
                                    json.dumps(timestamps), is_wish_list
                                )
                                
                                execution_time = time.time() - start_time
                                logger.info(f"[{operation_id}] Successfully created new item in {execution_time:.2f}s: ean={ean}, item_name={item_name}")
                                
                                return {
                                    "ean": ean, 
                                    "product_name": item_name, 
                                    "done": True, 
                                    "subgroups": subgroups,
                                    "operation": "created_new",
                                    "execution_time": execution_time
                                }
                                
                            except Exception as db_error:
                                logger.error(f"[{operation_id}] Database error creating new item: {str(db_error)}")
                                raise HTTPException(
                                    status_code=500, 
                                    detail=f"Database error creating new item: {str(db_error)}"
                                )

                    # Step 4: Process existing item update/creation
                    logger.debug(f"[{operation_id}] Processing item update/creation for: {item_name}")
                    
                    existing_item = await con.fetchrow(
                        "SELECT ean, count, timestamps FROM item_list WHERE item_name = $1", 
                        item_name
                    )
                    
                    current_time = datetime.datetime.now().isoformat()
                    
                    if not existing_item:
                        logger.info(f"[{operation_id}] Creating new item: {item_name}")
                        
                        timestamps = [current_time] * count if count > 0 else []
                        
                        try:
                            await con.execute(
                                """INSERT INTO item_list 
                                   (ean, item_name, subgroups, class, count, timestamps, iswished) 
                                   VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                                ean, item_name, subgroups, "", count, 
                                json.dumps(timestamps), is_wish_list
                            )
                            
                            operation_type = "created"
                            logger.info(f"[{operation_id}] Successfully created item: {item_name}")
                            
                        except Exception as db_error:
                            logger.error(f"[{operation_id}] Database error creating item: {str(db_error)}")
                            raise HTTPException(
                                status_code=500, 
                                detail=f"Database error creating item: {str(db_error)}"
                            )
                    else:
                        logger.info(f"[{operation_id}] Updating existing item: {item_name}, current_count={existing_item['count']}, change={count}")
                        
                        existing_count = existing_item['count']
                        existing_timestamps = json.loads(existing_item['timestamps'] or '[]')
                        
                        try:
                            if count < 0:
                                # Removing items
                                items_to_remove = min(abs(count), existing_count)
                                remaining_timestamps = existing_timestamps[items_to_remove:]
                                new_count = existing_count - items_to_remove
                                logger.debug(f"[{operation_id}] Removing {items_to_remove} items, new_count={new_count}")
                            else:
                                # Adding items
                                new_timestamps = [current_time] * count
                                remaining_timestamps = existing_timestamps + new_timestamps
                                new_count = existing_count + count
                                logger.debug(f"[{operation_id}] Adding {count} items, new_count={new_count}")
                            
                            if new_count <= 0:
                                logger.info(f"[{operation_id}] Deleting item (count <= 0): {item_name}")
                                await con.execute(
                                    "DELETE FROM item_list WHERE item_name = $1", 
                                    item_name
                                )
                                operation_type = "deleted"
                            else:
                                await con.execute(
                                    """UPDATE item_list 
                                       SET count = $1, timestamps = $2 
                                       WHERE item_name = $3""", 
                                    new_count, json.dumps(remaining_timestamps), item_name
                                )
                                operation_type = "updated"
                                logger.info(f"[{operation_id}] Successfully updated item: {item_name}, new_count={new_count}")
                        
                        except Exception as db_error:
                            logger.error(f"[{operation_id}] Database error updating item: {str(db_error)}")
                            raise HTTPException(
                                status_code=500, 
                                detail=f"Database error updating item: {str(db_error)}"
                            )
                    
                    # Transaction completed successfully
                    execution_time = time.time() - start_time
                    logger.info(f"[{operation_id}] Transaction completed successfully in {execution_time:.2f}s, operation={operation_type}")
                    
                    return {
                        "ean": ean, 
                        "product_name": item_name, 
                        "done": True, 
                        "subgroups": subgroups,
                        "operation": operation_type,
                        "execution_time": execution_time
                    }
        
        except asyncpg.PostgresError as db_error:
            execution_time = time.time() - start_time
            logger.error(f"[{operation_id}] PostgreSQL error after {execution_time:.2f}s: {str(db_error)}")
            logger.error(f"[{operation_id}] PostgreSQL error details: {db_error.__class__.__name__}")
            raise HTTPException(
                status_code=500, 
                detail=f"Database operation failed: {str(db_error)}"
            )
        
        except Exception as db_error:
            execution_time = time.time() - start_time
            logger.error(f"[{operation_id}] Unexpected database error after {execution_time:.2f}s: {str(db_error)}")
            logger.error(f"[{operation_id}] Full traceback:\n{traceback.format_exc()}")
            raise HTTPException(
                status_code=500, 
                detail="Database operation failed due to unexpected error"
            )
    
    except HTTPException:
        execution_time = time.time() - start_time
        logger.warning(f"[{operation_id}] HTTPException raised after {execution_time:.2f}s")
        raise
    
    except Exception as e:
        execution_time = time.time() - start_time
        logger.error(f"[{operation_id}] Unexpected error after {execution_time:.2f}s: {str(e)}")
        logger.error(f"[{operation_id}] Full traceback:\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=500, 
            detail="Failed to add item due to unexpected error"
        )
        
        
@app.post("/send_inference_image")
async def create_upload_file(request: Request, image: UploadFile | None = None):
    if not image:
        return {"message": "No upload file sent"}
    
    if not request.app.state.net:
        raise HTTPException(status_code=503, detail="ML model not available")
    
    try:
        # Save image to temporary location
        temp_image_path = f"/tmp/temp_image_{datetime.datetime.now().timestamp()}.jpg"
        with open(temp_image_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
            
        probability, prediction = food_classifier.run_inference(temp_image_path, request.app.state.net)
        
        # Clean up temporary file
        try:
            os.remove(temp_image_path)
        except Exception:
            pass
            
        return {"prediction": prediction, "probability": probability}
        
    except Exception as e:
        logger.error(f"Error processing image: {e}")
        raise HTTPException(status_code=500, detail="Failed to process image")

def purge_folder(folder_rel: str):
    folder = Path(folder_rel)
    for p in folder.iterdir():
        if p.is_symlink():
            continue
        if p.is_file():
            p.unlink()
            
@app.post("/transcribe")
async def transcribe_endpoint(request: Request, file: UploadFile = File(...)):
    if not ENABLE_WHISPER_MODEL_CLOUD and not ENABLE_WHISPER_MODEL_LOCAL:
        raise Exception("""neither ENABLE_WHISPER_MODEL_CLOUD nor ENABLE_WHISPER_MODEL_LOCAL where enabled/set to true =>
                        this feature was disabled and cant be used if not one of them is turned on""")
    try:
        # Validate file type
        if not file.content_type or not (
            file.content_type.startswith("audio/") or 
            file.content_type in ["video/webm", "application/octet-stream"]
        ):
            logger.warning(f"Invalid content type: {file.content_type}")
            # Don't reject - some browsers send webm as application/octet-stream
        
        # Ensure uploads directory exists
        uploads_dir = "uploads"
        os.makedirs(uploads_dir, exist_ok=True)
        
        # Read file contents
        contents = await file.read()
        logger.info(f"Received file: {file.filename}, size: {len(contents)} bytes, type: {file.content_type}")
        
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file received")
        
        # Create safe filename
        safe_filename = f"audio_{int(time.time() * 1000)}.webm"
        file_path = os.path.join(uploads_dir, safe_filename)
        
        # Write file
        with open(file_path, "wb") as f:
            f.write(contents)
        
        logger.info(f"File saved to: {file_path}")
        
        # Check if whisper model is available
        if (not hasattr(request.app.state, 'whisper') or not request.app.state.whisper) and not ENABLE_WHISPER_MODEL_CLOUD:
            raise HTTPException(status_code=503, detail="Whisper model not available")
        
        # Transcribe
        logger.info("Starting transcription...")
        transcribed_text = transcribe(file_path=file_path, model=request.app.state.whisper, cloud=ENABLE_WHISPER_MODEL_CLOUD)
        logger.info(f"Transcription completed: {transcribed_text[:100]}...")
        
        #retrieve classes
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                query = "SELECT distinct(item_name) FROM item_list WHERE iswished = 'false'"
                rows = await con.fetch(query)
                classes = [r["item_name"] for r in rows]          
                #print(f"retrieved classes: {classes}")

        classified = classifier.classify(input_text=transcribed_text, classes=classes)
        class_retrieved = classified["category"]
        
        #checkout the retrieved item
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                await con.execute(
                        "UPDATE item_list SET count = count - 1 WHERE item_name = $1;",
                        class_retrieved
                    )
                await con.execute("""
                                  delete from item_list where count <= 0
                                  """)

        
        # Clean up file
        try:
            os.remove(file_path)
            purge_folder("uploads")
            logger.debug(f"Cleaned up file: {file_path}")
        except Exception as cleanup_error:
            logger.warning(f"Failed to cleanup file {file_path}: {cleanup_error}")
        
        return {
            "transcribed_text": transcribed_text, 
            "class_retrieved": class_retrieved,
            "size": len(contents),
            "filename": safe_filename
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        logger.error(f"Full traceback:\n{traceback.format_exc()}")
        
        # Clean up file if it exists
        if 'file_path' in locals():
            try:
                os.remove(file_path)
            except:
                pass
        
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    
    
    
# Background task (if needed)
async def food_name_classifier(sleep_interval=60*60):
    """Background classification task"""
    logger.info("[Background task] Started")
    try:
        while True:
            await asyncio.sleep(sleep_interval)  # Use async sleep
            logger.info(f"[{datetime.datetime.now()}] food_classifier task running...")
    except Exception as e:
        logger.error(f"[food_classifier task error]: {e}")
    finally:
        logger.info("food_classifier task stopped")

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=3030,
        reload=False,
        log_level="info",  # Changed from debug
        workers=1,
        loop="uvloop",
        http="httptools",
        access_log=True
    )
