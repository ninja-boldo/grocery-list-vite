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

import psycopg2




if os.getenv('RUNNING_IN_CONTAINER'):
    DATABASE_URL = "postgresql://postgres:postgres@postgres-db:5432/maindb"
    CSV_FILE = "/app/openfoodfacts.csv"
else:
    DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/maindb"
    CSV_FILE = "/Users/bennetjollenbeck/Desktop/programming/web/react/family_projects/grocery-list2/server/openfoodfacts.csv"


api_key = "one-rgs iodesftheontisissihdebeten thncstthinciree wholeswedissh-ek-"

scheduler = AsyncIOScheduler()

device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')

def init_database(con):
    """Initialize database schema if it doesn't exist"""
    try:
        with con.cursor() as cur:
            # Create food table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS food (
                    code TEXT,
                    product_name TEXT,
                    quantity text,
                    packaging TEXT,
                    brands_en TEXT,
                    categories TEXT,
                    ingredients_text TEXT,
                    energy_kcal_100g text
                );
            """)
            
            
            # Create item_list table (PostgreSQL syntax)
            cur.execute("""
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
            

            cur.execute("SELECT COUNT(*) FROM food;")
            count = cur.fetchone()[0]
            
            if count == 0 and os.path.exists(CSV_FILE):
                cur.execute(f"""
                    COPY food (code, product_name, quantity, packaging, brands_en, categories, ingredients_text, energy_kcal_100g)
                    FROM '{CSV_FILE}'
                    DELIMITER ','
                    CSV HEADER;
                """)
                logging.getLogger("fastapi-logger").info(f"Loaded data from {CSV_FILE}")
            
            con.commit()  # Commit all change
            
            cur.execute("SELECT COUNT(*) FROM food;")
            count = cur.fetchone()[0]
            
            print(f"now the food table has {count} entries")
            # List tables
            cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public';")
            tables = cur.fetchall()
            logging.getLogger("fastapi-logger").info(f"Available tables: {tables}")

        
        logging.getLogger("fastapi-logger").info("Database schema initialized successfully")
    except Exception as e:
        logging.getLogger("fastapi-logger").error(f"Failed to initialize database schema: {e}")
        # Don't raise - continue without CSV data if needed

@asynccontextmanager
async def lifespan(app: FastAPI):
    global DATABASE_URL
    
    try:
        app.state.con = psycopg2.connect(DATABASE_URL)
        app.state.con.autocommit = True  # Enable autocommit for PostgreSQL
        
        # Initialize database schema
        init_database(app.state.con)

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
        if hasattr(app.state, 'con'):
            app.state.con.close()
            logger.info("postgres connection closed")

app = FastAPI(lifespan=lifespan, debug=True)

Instrumentator().instrument(app).expose(app)

handler = LokiHandler(
    url="http://192.168.1.13:3100/loki/api/v1/push",
    tags={"application": "fastapi-backend-grocery-list"},
    auth=None,
    version="1"
)

# Add file handler
file_handler = logging.FileHandler('server.log')
file_handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
file_handler.setFormatter(formatter)

logger = logging.getLogger("fastapi-logger")
logger.addHandler(handler)      # Loki
logger.addHandler(file_handler) # File
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

    # Wrap the call_next in try-catch to capture all exceptions
    try:
        return await call_next(request)
    except Exception as e:
        # Log the full traceback
        logger.error(f"Unhandled exception on {request.method} {request.url.path}: {str(e)}")
        logger.error(f"Query params: {dict(request.query_params)}")
        logger.error(f"Full traceback:\n{traceback.format_exc()}")
        
        # Return detailed error response
        return JSONResponse(
            status_code=500,
            content={
                "detail": f"Internal server error: {str(e)}",
                "path": str(request.url.path),
                "method": request.method,
                "query_params": dict(request.query_params)
            }
        )

@app.get("/fetch_subgroups")
async def fetch_subgroups(request: Request):
    logger.info(f"invoked fetch_subgroups at {datetime.datetime.now()}")

    try:
        with request.app.state.con.cursor() as cur:
            cur.execute("SELECT DISTINCT subgroups FROM item_list WHERE subgroups != '' AND subgroups IS NOT NULL")
            subgroups = cur.fetchall()
        
        logger.info(f"subgroups being fetched: {len(subgroups)} items")
        return {"subgroups": [sg[0] for sg in subgroups]}
    except Exception as e:
        logger.error(f"Error fetching subgroups: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch subgroups")

@app.get("/fetch_classnames")
async def fetch_classnames(request: Request):
    logger.info(f"invoked fetch_classnames at {datetime.datetime.now()}")

    try:
        with request.app.state.con.cursor() as cur:
            cur.execute("SELECT DISTINCT class FROM item_list WHERE class != '' AND class IS NOT NULL")
            classnames = cur.fetchall()
        
        logger.info(f"classnames being fetched: {len(classnames)} items")
        return {"classnames": [cn[0] for cn in classnames]}
    except Exception as e:
        logger.error(f"Error fetching classnames: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch classnames")
 
@app.get("/fetch_items")
async def fetch_items(request: Request, subgroups: Optional[str] = Query(None), classnames: Optional[str] = Query(None)):
    logger.info(f"invoked fetch_items at {datetime.datetime.now()}")

    try:
        with request.app.state.con.cursor() as cur:
            if subgroups and classnames:
                cur.execute("SELECT ean, item_name, subgroups, class, count FROM item_list WHERE subgroups = %s AND class = %s",
                                    (subgroups, classnames))
            elif subgroups: 
                cur.execute("SELECT ean, item_name, subgroups, class, count FROM item_list WHERE subgroups = %s", (subgroups,))
            elif classnames:
                cur.execute("SELECT ean, item_name, subgroups, class, count FROM item_list WHERE class = %s", (classnames,))
            else:
                cur.execute("SELECT ean, item_name, subgroups, class, count FROM item_list")

            items = cur.fetchall()
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

    try:
        if not ean and not item_name:
            raise HTTPException(status_code=400, detail="You must supply either ean or item_name")
        
        if count is None:
            count = 1
            
        if not subgroups:
            subgroups = ""

        with request.app.state.con.cursor() as cur:
            # Get item_name from ean if not provided
            if ean and not item_name:        
                cur.execute("SELECT item_name FROM item_list WHERE ean = %s", (ean,))
                result = cur.fetchone()
                if result:
                    item_name = result[0]
                else:
                    # Try to get from food table
                    cur.execute("SELECT product_name FROM food WHERE code = %s", (ean,))
                    result = cur.fetchone()
                    if result:
                        item_name = result[0]
                    else:
                        raise HTTPException(status_code=404, detail="Item not found for given EAN")

            # Get ean from item_name if not provided
            if item_name and not ean:
                cur.execute("SELECT ean FROM item_list WHERE item_name = %s", (item_name,))
                result = cur.fetchone()
                if result:
                    ean = result[0]
                else:
                    ean = -1

            class_name = ""

            logger.info(f"Processing: ean={ean}, item_name={item_name}, count={count}")

            # Get product name from food table
            cur.execute("SELECT product_name FROM food WHERE code = %s", (ean,))
            product_name_result = cur.fetchone()
            product_name = product_name_result[0] if product_name_result else item_name

            # Check if item already exists
            cur.execute("SELECT ean, count FROM item_list WHERE item_name = %s", (item_name,))
            existing_item = cur.fetchone()
            
            if not existing_item:
                # Insert new item
                cur.execute(
                    "INSERT INTO item_list (ean, item_name, subgroups, class, count) VALUES (%s, %s, %s, %s, %s)",
                    (ean, item_name, subgroups, class_name, count)
                )
                logger.info(f"Added new item: {item_name}")
            else:
                # Update existing item count
                new_count = existing_item[1] + count
                if new_count <= 0:
                    cur.execute("DELETE FROM item_list WHERE item_name = %s", (item_name,))
                    logger.info(f"Removed item: {item_name}")
                else:
                    cur.execute("UPDATE item_list SET count = %s WHERE item_name = %s", (new_count, item_name))
                    logger.info(f"Updated item count: {item_name} = {new_count}")

        return {"ean": ean, "product_name": product_name, "done": True, "subgroups": subgroups}
        
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
    logger.info(f"invoked add_ean_manual at {datetime.datetime.now()}")

    try:
        count = int(count)  # make sure it is the correct type
        
        if not ean and not item_name:
            raise HTTPException(status_code=400, detail="You must supply either ean or item_name")
        
        if count is None:
            count = 1
            
        if not subgroups:
            subgroups = ""
        
        if not ean:
            ean = "0"
        
        try:
            logger.info(f"line 361 ean: {ean} item_name: {item_name}")
            
            with request.app.state.con.cursor() as cur:
                # Get item_name from ean if not provided
                if ean and ean != "0" and not item_name:        
                    cur.execute("SELECT item_name FROM item_list WHERE ean = %s", (ean,))
                    result = cur.fetchone()
                    if result:
                        item_name = result[0]
                    else:
                        # Try to get from food table
                        cur.execute("SELECT product_name FROM food WHERE code = %s", (ean,))
                        result = cur.fetchone()
                        if result:
                            item_name = result[0]
                        else:
                            raise HTTPException(status_code=404, detail="Item not found for given EAN")

                # Get ean from item_name if not provided
                elif item_name and (not ean or ean == "0"):
                    cur.execute("SELECT ean FROM item_list WHERE item_name = %s", (item_name,))
                    result = cur.fetchone()
                    if result:
                        ean = result[0]
                
                # Add to the food db if it hasn't been there before
                elif item_name and ean and ean != "0":
                    cur.execute("SELECT item_name FROM item_list WHERE ean = %s", (ean,))
                    result = cur.fetchone()
                    if not result:
                        cur.execute(
                            "INSERT INTO item_list (ean, item_name, subgroups, class, count) VALUES (%s, %s, %s, %s, %s)",
                            (ean, item_name, subgroups, "", count)
                        )
                        logger.info(f"Added new item to item_list: {item_name}")
                        return {"ean": ean, "product_name": item_name, "done": True, "subgroups": subgroups}
            
        except Exception as e:
            logger.info(f"""failed to get ean or item name with the other out of the db =>
                        not listed in the main db by now \nfor ean: {ean} and item name: {item_name}
                        Error: {e}""")
    
        class_name = ""
               
        ean, item_name, count = str(ean), str(item_name), int(count)

        logger.info(f"Processing: ean={ean}, item_name={item_name}, count={count}")

        # Use item_name as product_name for manual entries
        product_name = item_name
        
        with request.app.state.con.cursor() as cur:
            # Check if item already exists
            cur.execute("SELECT ean, count FROM item_list WHERE item_name = %s", (item_name,))
            existing_item = cur.fetchone()
            
            if not existing_item:
                # Insert new item
                cur.execute(
                    "INSERT INTO item_list (ean, item_name, subgroups, class, count) VALUES (%s, %s, %s, %s, %s)",
                    (ean, item_name, subgroups, class_name, count)
                )
                logger.info(f"Added new item: {item_name}")
            else:
                # Update existing item count
                new_count = existing_item[1] + count
                if new_count <= 0:
                    cur.execute("DELETE FROM item_list WHERE item_name = %s", (item_name,))
                    logger.info(f"Removed item: {item_name}")
                else:
                    cur.execute("UPDATE item_list SET count = %s WHERE item_name = %s", (new_count, item_name))
                    logger.info(f"Updated item count: {item_name} = {new_count}")

        return {"ean": ean, "product_name": product_name, "done": True, "subgroups": subgroups}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding EAN manually: {e}")
        raise HTTPException(status_code=500, detail="Failed to add item")
    

async def food_name_classifier(sleep_intervall=60*60):
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
    

def fix_table_schema(cur):
    """Recreate table from scratch - use if backup fails"""
    try:
        logger.info("Recreating table fresh (no backup)...")
        
        # Drop and recreate table
        cur.execute("DROP TABLE IF EXISTS item_list")
        
        # Create new table with proper PostgreSQL schema
        cur.execute("""
            CREATE TABLE item_list (
                id SERIAL PRIMARY KEY,
                ean TEXT,
                item_name TEXT,
                subgroups TEXT,
                class TEXT,
                count INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        logger.info("Table recreated successfully (fresh start)")
        
    except Exception as e:
        logger.error(f"Error recreating table: {e}")
        raise


if __name__ == "__main__":
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