# server.py
import os
os.environ['KMP_DUPLICATE_LIB_OK']='True'

import datetime
import shutil
from typing import Optional
import duckdb
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request, UploadFile, HTTPException
import torch
import uvicorn

from fastapi.responses import PlainTextResponse

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import food_classifier.main as food_classifier

from prometheus_fastapi_instrumentator import Instrumentator

import time
import logging
from logging_loki import LokiHandler

# Use environment variable for database path with fallback
DB_PATH = os.getenv("DB_PATH", "data/openfoodfacts.db")

api_key = "one-rgs iodesftheontisissihdebeten thncstthinciree wholeswedissh-ek-"

scheduler = AsyncIOScheduler()

device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')

def init_database(con):
    """Initialize database schema if it doesn't exist"""
    try:
        # Create item_list table
        con.execute("""
            CREATE TABLE IF NOT EXISTS main.item_list (
                id INTEGER PRIMARY KEY,
                ean TEXT,
                item_name TEXT,
                subgroups TEXT,
                class TEXT,
                count INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create food table if it doesn't exist
        con.execute("""
            CREATE TABLE IF NOT EXISTS main.food (
                code TEXT PRIMARY KEY,
                product_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create indexes for better performance
        con.execute("CREATE INDEX IF NOT EXISTS idx_item_list_ean ON main.item_list(ean)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_item_list_name ON main.item_list(item_name)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_food_code ON main.food(code)")
        
        logging.getLogger("fastapi-logger").info("Database schema initialized successfully")
    except Exception as e:
        logging.getLogger("fastapi-logger").error(f"Failed to initialize database schema: {e}")
        raise

def find_openfoodfacts_db(start_path=None, max_depth=5):
    """
    Search for OpenFoodFacts.db in start_path up to max_depth,
    excluding any node_modules folders.
    Returns the relative path to the file if found, else None.
    """
    if start_path is None or start_path == '.':
        start_path = os.path.dirname(os.path.abspath(__file__))

    def _search(current_path, current_depth):
        if current_depth > max_depth:
            return None
        
        try:
            with os.scandir(current_path) as it:
                for entry in it:
                    if entry.is_dir(follow_symlinks=False):
                        if entry.name == 'node_modules':
                            continue
                        found = _search(entry.path, current_depth + 1)
                        if found:
                            return found
                    elif entry.is_file(follow_symlinks=False) and entry.name.lower() in ["openfoodfacts.db", "openfoodfacts.djkhb"]:
                        return os.path.relpath(entry.path, start_path)
        except PermissionError:
            pass
        return None

    return _search(start_path, 0)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global DB_PATH
    
    # Ensure directory exists
    db_dir = os.path.dirname(DB_PATH)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    
    # Check if database file exists
    if not os.path.exists(DB_PATH):
        logger.warning(f"Database file does not exist, will be created: {DB_PATH}")
    
    app.state.con = duckdb.connect(DB_PATH)
    
    # Initialize database schema
    init_database(app.state.con)
    
    logger.info(f"DuckDB connection opened: {DB_PATH}")

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

    # Start background scheduler
    scheduler.add_job(food_name_classifier, CronTrigger(hour="*/2", minute=0))
    scheduler.start()

    yield

    scheduler.shutdown()
    app.state.con.close()
    logger.info("DuckDB connection closed")

app = FastAPI(lifespan=lifespan)

Instrumentator().instrument(app).expose(app)

handler = LokiHandler(
    url="http://192.168.1.13:3100/loki/api/v1/push",
    tags={"application": "fastapi-backend-grocery-list"},
    auth=None,
    version="1"
)
logger = logging.getLogger("fastapi-logger")
logger.addHandler(handler)
logger.setLevel(logging.INFO)

@app.middleware("http")
async def protect_metrics(request: Request, call_next):
    logger.info(f"invoked protect_metrics at {datetime.datetime.now()}")
    if request.url.path == "/metrics":
        logger.info(f"received metrics request at this time: {datetime.datetime.now()}")

        auth_header = request.headers.get("Authorization")

        if not auth_header or not auth_header.startswith("Bearer "):
            return PlainTextResponse("Unauthorized", status_code=401)

        token = auth_header.removeprefix("Bearer ").strip()

        if token != api_key:
            logger.info(f"Provided token: '{token}', expected: '{api_key}'")
            return PlainTextResponse("Unauthorized", status_code=401)

    return await call_next(request)

@app.get("/fetch_subgroups")
async def fetch_subgroups(request: Request):
    logger.info(f"invoked fetch_subgroups at {datetime.datetime.now()}")

    con = request.app.state.con
    
    try:
        subgroups = con.execute("SELECT DISTINCT subgroups FROM main.item_list WHERE subgroups != '' AND subgroups IS NOT NULL").fetchall()
        logger.info(f"subgroups being fetched: {len(subgroups)} items")
        return {"subgroups": [sg[0] for sg in subgroups]}
    except Exception as e:
        logger.error(f"Error fetching subgroups: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch subgroups")

@app.get("/fetch_classnames")
async def fetch_classnames(request: Request):
    logger.info(f"invoked fetch_classnames at {datetime.datetime.now()}")

    con = request.app.state.con
    
    try:
        classnames = con.execute("SELECT DISTINCT class FROM main.item_list WHERE class != '' AND class IS NOT NULL").fetchall()
        logger.info(f"classnames being fetched: {len(classnames)} items")
        return {"classnames": [cn[0] for cn in classnames]}
    except Exception as e:
        logger.error(f"Error fetching classnames: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch classnames")
 
@app.get("/fetch_items")
async def fetch_items(request: Request, subgroups: Optional[str] = Query(None), classnames: Optional[str] = Query(None)):
    logger.info(f"invoked fetch_items at {datetime.datetime.now()}")

    con = request.app.state.con
    
    try:
        if subgroups and classnames:
            items = con.execute("SELECT * FROM main.item_list WHERE subgroups = ? AND class = ?", (subgroups, classnames)).fetchall()
        elif subgroups: 
            items = con.execute("SELECT * FROM main.item_list WHERE subgroups = ?", (subgroups,)).fetchall()
        elif classnames:
            items = con.execute("SELECT * FROM main.item_list WHERE class = ?", (classnames,)).fetchall()
        else:
            items = con.execute("SELECT * FROM main.item_list").fetchall()

        return {"item_list": items}
    except Exception as e:
        logger.error(f"Error fetching items: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch items")

@app.get("/add_ean_to_list/")
async def add_ean(
    request: Request,
    ean: Optional[str] = Query(None, min_length=8, max_length=14),
    subgroups: Optional[str] = Query(None),
    count: Optional[int] = Query(1),
    item_name: Optional[str] = Query(None)
):
    logger.info(f"invoked add_ean at {datetime.datetime.now()}")

    con = request.app.state.con
    
    try:
        if not ean and not item_name:
            raise HTTPException(status_code=400, detail="You must supply either ean or item_name")
        
        if count is None:
            count = 1
            
        if not subgroups:
            subgroups = ""

        # Get item_name from ean if not provided
        if ean and not item_name:        
            result = con.execute("SELECT item_name FROM main.item_list WHERE ean = ?", (ean,)).fetchone()
            if result:
                item_name = result[0]
            else:
                # Try to get from food table
                result = con.execute("SELECT product_name FROM main.food WHERE code = ?", (ean,)).fetchone()
                if result:
                    item_name = result[0]
                else:
                    raise HTTPException(status_code=404, detail="Item not found for given EAN")

        # Get ean from item_name if not provided
        if item_name and not ean:
            result = con.execute("SELECT ean FROM main.item_list WHERE item_name = ?", (item_name,)).fetchone()
            if result:
                ean = result[0]

        class_name = ""

        logger.info(f"Processing: ean={ean}, item_name={item_name}, count={count}")

        # Get product name from food table
        product_name_result = con.execute("SELECT product_name FROM main.food WHERE code = ?", (ean,)).fetchone()
        product_name = product_name_result[0] if product_name_result else item_name

        # Check if item already exists
        existing_item = con.execute("SELECT id, count FROM main.item_list WHERE item_name = ?", (item_name,)).fetchone()
        
        if not existing_item:
            # Insert new item
            con.execute(
                "INSERT INTO main.item_list (ean, item_name, subgroups, class, count) VALUES (?, ?, ?, ?, ?)",
                (ean, item_name, subgroups, class_name, count)
            )
            logger.info(f"Added new item: {item_name}")
        else:
            # Update existing item count
            new_count = existing_item[1] + count
            if new_count <= 0:
                con.execute("DELETE FROM main.item_list WHERE item_name = ?", (item_name,))
                logger.info(f"Removed item: {item_name}")
            else:
                con.execute("UPDATE main.item_list SET count = ? WHERE item_name = ?", (new_count, item_name))
                logger.info(f"Updated item count: {item_name} = {new_count}")

        return {"ean": ean, "product_name": product_name, "done": True, "subgroups": subgroups}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding EAN: {e}")
        raise HTTPException(status_code=500, detail="Failed to add item")

async def food_name_classifier(sleep_intervall=60*60):
    con = duckdb.connect(DB_PATH)
    logger.info("[Background task] Connection opened")

    try:
        while True:
            try:
                logger.info(f"[{datetime.datetime.now()}] food_classifier task running...")
                # Placeholder for classification logic
                time.sleep(sleep_intervall)
            except Exception as e:
                logger.error(f"[food_classifier task error]: {e}")
                time.sleep(60)  # Wait before retrying

    finally:
        con.close()
        logger.info("food_classifier Connection closed")

@app.post("/send_inference_image")
async def create_upload_file(request: Request, image: UploadFile | None = None):
    if not image:
        logger.info("No image received")
        return {"message": "No upload file sent"}
    
    if not request.app.state.net:
        raise HTTPException(status_code=503, detail="ML model not available")
    
    try:
        logger.info(f"Received image: {image.filename}")
        
        # Save image to temporary location
        temp_image_path = f"/tmp/temp_image_{datetime.datetime.now().timestamp()}.jpg"
        with open(temp_image_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
            
        logger.info(f"Image saved to: {temp_image_path}")
            
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
    
if __name__ == "__main__":
    # Try to find database file
    found_db = find_openfoodfacts_db()
    if found_db:
        DB_PATH = found_db
        logger.info(f"Found database at: {DB_PATH}")
    else:
        logger.info(f"Using default database path: {DB_PATH}")
    
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=3030,
        reload=False,
        log_level="debug",
        workers=1,
        loop="uvloop",
        http="httptools",
    )