import os
import traceback
os.environ['KMP_DUPLICATE_LIB_OK']='True'

import datetime
import shutil
from typing import Optional, Union
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request, UploadFile, HTTPException
import torch
import uvicorn

from fastapi.responses import JSONResponse, PlainTextResponse

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger  # noqa: F401

import food_classifier.main as food_classifier

from prometheus_fastapi_instrumentator import Instrumentator

import time
import logging
from logging_loki import LokiHandler

# Use asyncpg instead of psycopg2 for better async performance
import asyncpg
from functools import lru_cache
import asyncio


from logging.handlers import QueueHandler, QueueListener, RotatingFileHandler
import queue


if os.getenv('RUNNING_IN_CONTAINER'):
    DATABASE_URL = "postgresql://postgres:postgres@postgres-db:5432/maindb"
    CSV_FILE = "/app/openfoodfacts.csv"
else:
    DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/maindb"
    CSV_FILE = "/Users/bennetjollenbeck/Desktop/programming/web/react/family_projects/grocery-list2/server/openfoodfacts.csv"

api_key = "one-rgs iodesftheontisissihdebeten thncstthinciree wholeswedissh-ek-"

scheduler = AsyncIOScheduler()

device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')

async def init_database(pool):
    """Initialize database schema if it doesn't exist - async version"""
    try:
        async with pool.acquire() as con:
            # Create food table
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
            
            # Create item_list table (PostgreSQL syntax)
            await con.execute("""
                CREATE TABLE IF NOT EXISTS item_list (
                    id SERIAL PRIMARY KEY,
                    ean TEXT,
                    item_name TEXT,
                    subgroups TEXT,
                    class TEXT,
                    count INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            
            # Add indexes for performance
            await con.execute("CREATE INDEX IF NOT EXISTS idx_item_list_subgroups ON item_list(subgroups);")
            await con.execute("CREATE INDEX IF NOT EXISTS idx_item_list_class ON item_list(class);")
            await con.execute("CREATE INDEX IF NOT EXISTS idx_item_list_ean ON item_list(ean);")
            await con.execute("CREATE INDEX IF NOT EXISTS idx_item_list_item_name ON item_list(item_name);")
            await con.execute("CREATE INDEX IF NOT EXISTS idx_item_list_subgroups_class ON item_list(subgroups, class);")
            await con.execute("CREATE INDEX IF NOT EXISTS idx_food_code ON food(code);")
            await con.execute("CREATE INDEX IF NOT EXISTS idx_food_product_name ON food(product_name);")

            count = await con.fetchval("SELECT COUNT(*) FROM food;")
            
            if count == 0 and os.path.exists(CSV_FILE):
                # Use COPY for bulk insert - more efficient than individual inserts
                with open(CSV_FILE, 'r', encoding='utf-8') as f:
                    await con.copy_from_table(
                        'food', 
                        source=f,
                        columns=['code', 'product_name', 'quantity', 'packaging', 'brands_en', 
                                'categories', 'ingredients_text', 'energy_kcal_100g'],
                        format='csv',
                        header=True,
                        delimiter=','
                    )
                logging.getLogger("fastapi-logger").info(f"Loaded data from {CSV_FILE}")
            
            count = await con.fetchval("SELECT COUNT(*) FROM food;")
            print(f"Food table has {count} entries")
            
            # List tables
            tables = await con.fetch("SELECT tablename FROM pg_tables WHERE schemaname = 'public';")
            logging.getLogger("fastapi-logger").info(f"Available tables: {[t['tablename'] for t in tables]}")

        logging.getLogger("fastapi-logger").info("Database schema initialized successfully")
    except Exception as e:
        logging.getLogger("fastapi-logger").error(f"Failed to initialize database schema: {e}")
        # Don't raise - continue without CSV data if needed

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        # Create async connection pool
        app.state.pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=2,
            max_size=10,
            command_timeout=30,
            server_settings={'jit': 'off'}  # Disable JIT for faster simple queries
        )
        
        # Initialize database schema
        await init_database(app.state.pool)

        # Load ML model
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

        yield

    finally:
        if hasattr(app.state, 'pool'):
            await app.state.pool.close()
            logger.info("Database pool closed")

app = FastAPI(lifespan=lifespan, debug=False)  # Set debug=False for production

Instrumentator().instrument(app).expose(app)

# Optimized logging setup


# Create queue for async logging
log_queue = queue.Queue()

# Setup handlers
loki_handler = LokiHandler(
    url="http://192.168.1.13:3100/loki/api/v1/push",
    tags={"application": "fastapi-backend-grocery-list"},
    auth=None,
    version="1"
)

file_handler = RotatingFileHandler(
    'server.log', 
    maxBytes=10*1024*1024,  # 10MB
    backupCount=5
)
file_handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
file_handler.setFormatter(formatter)

# Create queue listener
queue_listener = QueueListener(log_queue, file_handler, loki_handler, respect_handler_level=True)

# Setup logger with queue handler
logger = logging.getLogger("fastapi-logger")
queue_handler = QueueHandler(log_queue)
logger.addHandler(queue_handler)
logger.setLevel(logging.INFO)

# Start queue listener
queue_listener.start()

@app.middleware("http")
async def optimized_middleware(request: Request, call_next):
    # Only log important events, not every request
    if request.url.path == "/metrics":
        auth_header = request.headers.get("Authorization")

        if not auth_header or not auth_header.startswith("Bearer "):
            return PlainTextResponse("Unauthorized", status_code=401)

        token = auth_header.removeprefix("Bearer ").strip()

        if token != api_key:
            logger.warning("Unauthorized metrics access attempt")
            return PlainTextResponse("Unauthorized", status_code=401)

    # Handle exceptions
    try:
        start_time = time.time()
        response = await call_next(request)
        process_time = time.time() - start_time
        
        # Log slow requests (>1 second) or errors
        if process_time > 1.0 or (hasattr(response, 'status_code') and response.status_code >= 400):
            logger.warning(f"Slow/Error request: {request.method} {request.url.path} - {process_time:.2f}s - Status: {getattr(response, 'status_code', 'unknown')}")
        
        return response
    except Exception as e:
        logger.error(f"Unhandled exception on {request.method} {request.url.path}: {str(e)}")
        logger.error(f"Full traceback:\n{traceback.format_exc()}")
        
        return JSONResponse(
            status_code=500,
            content={
                "detail": f"Internal server error: {str(e)}",
                "path": str(request.url.path),
                "method": request.method
            }
        )

# Cache for frequently accessed queries
@lru_cache(maxsize=50)
def get_distinct_query(field: str) -> str:
    return f"SELECT DISTINCT {field} FROM item_list WHERE {field} != '' AND {field} IS NOT NULL ORDER BY {field}"

@app.get("/fetch_subgroups")
async def fetch_subgroups(request: Request):
    try:
        async with request.app.state.pool.acquire() as con:
            subgroups = await con.fetch(get_distinct_query("subgroups"))
        
        return {"subgroups": [sg['subgroups'] for sg in subgroups]}
    except Exception as e:
        logger.error(f"Error fetching subgroups: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch subgroups")

@app.get("/fetch_classnames")
async def fetch_classnames(request: Request):
    try:
        async with request.app.state.pool.acquire() as con:
            classnames = await con.fetch(get_distinct_query("class"))
        
        return {"classnames": [cn['class'] for cn in classnames]}
    except Exception as e:
        logger.error(f"Error fetching classnames: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch classnames")

# Batch endpoint to reduce round trips
@app.get("/fetch_all_metadata")
async def fetch_all_metadata(request: Request):
    """Fetch subgroups and classnames in one request to reduce round trips"""
    try:
        async with request.app.state.pool.acquire() as con:
            # Execute both queries concurrently
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

@app.get("/fetch_items")
async def fetch_items(
    request: Request, 
    subgroups: Optional[str] = Query(None), 
    classnames: Optional[str] = Query(None)
):
    try:
        async with request.app.state.pool.acquire() as con:
            # Use parameterized queries for better performance and security
            if subgroups and classnames:
                query = """
                    SELECT ean, item_name, subgroups, class, count 
                    FROM item_list 
                    WHERE subgroups = $1 AND class = $2
                    ORDER BY item_name
                """
                items = await con.fetch(query, subgroups, classnames)
            elif subgroups:
                query = """
                    SELECT ean, item_name, subgroups, class, count 
                    FROM item_list 
                    WHERE subgroups = $1
                    ORDER BY item_name
                """
                items = await con.fetch(query, subgroups)
            elif classnames:
                query = """
                    SELECT ean, item_name, subgroups, class, count 
                    FROM item_list 
                    WHERE class = $1
                    ORDER BY item_name
                """
                items = await con.fetch(query, classnames)
            else:
                # Add pagination for large datasets
                query = """
                    SELECT ean, item_name, subgroups, class, count 
                    FROM item_list 
                    ORDER BY item_name
                    LIMIT 1000
                """
                items = await con.fetch(query)

            # Convert to list of tuples for compatibility with existing frontend
            item_list = [(item['ean'], item['item_name'], item['subgroups'], 
                         item['class'], item['count']) for item in items]
            
            return {"item_list": item_list}
            
    except Exception as e:
        logger.error(f"Error fetching items: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch items")

@app.get("/add_ean_to_list/")
async def add_ean_to_list(
    request: Request,
    ean: Optional[str] = Query(None, min_length=8, max_length=14),
    subgroups: Optional[str] = Query(None),
    count: Optional[int] = Query(1),
    item_name: Optional[str] = Query(None)
):
    if not ean and not item_name:
        raise HTTPException(status_code=400, detail="You must supply either ean or item_name")
    
    count = count or 1
    subgroups = subgroups or ""

    try:
        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                # Single query to get or create item info
                if ean and not item_name:
                    # Try item_list first, then food table
                    result = await con.fetchrow(
                        "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                    )
                    if result:
                        item_name = result['item_name']
                    else:
                        result = await con.fetchrow(
                            "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
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

                # Use UPSERT (INSERT ... ON CONFLICT) for better performance
                result = await con.fetchrow(
                    "SELECT count FROM item_list WHERE item_name = $1", item_name
                )
                
                if not result:
                    await con.execute(
                        """INSERT INTO item_list (ean, item_name, subgroups, class, count) 
                           VALUES ($1, $2, $3, $4, $5)""",
                        ean, item_name, subgroups, "", count
                    )
                else:
                    new_count = result['count'] + count
                    if new_count <= 0:
                        await con.execute(
                            "DELETE FROM item_list WHERE item_name = $1", item_name
                        )
                    else:
                        await con.execute(
                            "UPDATE item_list SET count = $1 WHERE item_name = $2",
                            new_count, item_name
                        )

                # Get product name for response
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
    item_name: Optional[str] = Query(None)
):
    try:
        count = int(count)
        
        if not ean and not item_name:
            raise HTTPException(status_code=400, detail="You must supply either ean or item_name")
        
        count = count or 1
        subgroups = subgroups or ""
        ean = ean or "0"

        async with request.app.state.pool.acquire() as con:
            async with con.transaction():
                # Get item_name from ean if not provided
                if ean and ean != "0" and not item_name:        
                    result = await con.fetchrow("SELECT item_name FROM item_list WHERE ean = $1", ean)
                    if result:
                        item_name = result['item_name']
                    else:
                        result = await con.fetchrow("SELECT product_name FROM food WHERE code = $1", ean)
                        if result:
                            item_name = result['product_name']
                        else:
                            raise HTTPException(status_code=404, detail="Item not found for given EAN")

                # Get ean from item_name if not provided
                elif item_name and (not ean or ean == "0"):
                    result = await con.fetchrow("SELECT ean FROM item_list WHERE item_name = $1", item_name)
                    ean = result['ean'] if result else "0"
                
                # Add to the food db if it hasn't been there before
                elif item_name and ean and ean != "0":
                    result = await con.fetchrow("SELECT item_name FROM item_list WHERE ean = $1", ean)
                    if not result:
                        await con.execute(
                            "INSERT INTO item_list (ean, item_name, subgroups, class, count) VALUES ($1, $2, $3, $4, $5)",
                            ean, item_name, subgroups, "", count
                        )
                        return {"ean": ean, "product_name": item_name, "done": True, "subgroups": subgroups}

                # Process item addition/update
                existing_item = await con.fetchrow("SELECT ean, count FROM item_list WHERE item_name = $1", item_name)
                
                if not existing_item:
                    await con.execute(
                        "INSERT INTO item_list (ean, item_name, subgroups, class, count) VALUES ($1, $2, $3, $4, $5)",
                        ean, item_name, subgroups, "", count
                    )
                else:
                    new_count = existing_item['count'] + count
                    if new_count <= 0:
                        await con.execute("DELETE FROM item_list WHERE item_name = $1", item_name)
                    else:
                        await con.execute("UPDATE item_list SET count = $1 WHERE item_name = $2", new_count, item_name)

                return {"ean": ean, "product_name": item_name, "done": True, "subgroups": subgroups}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding EAN manually: {e}")
        raise HTTPException(status_code=500, detail="Failed to add item")

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
        except:
            pass
            
        return {"prediction": prediction, "probability": probability}
        
    except Exception as e:
        logger.error(f"Error processing image: {e}")
        raise HTTPException(status_code=500, detail="Failed to process image")

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
        access_log=False,  # Disable access logging for better performance
    )