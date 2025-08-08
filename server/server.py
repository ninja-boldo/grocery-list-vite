# server.py
import os
os.environ['KMP_DUPLICATE_LIB_OK']='True'


import datetime
import shutil
from typing import Optional
import duckdb
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request, UploadFile
import torch
import uvicorn

from fastapi.responses import PlainTextResponse

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

#from classification import classifier as cl

import food_classifier.main as food_classifier

from prometheus_fastapi_instrumentator import Instrumentator

import time

import logging
from logging_loki import LokiHandler



#   https://swedish-desire-derek-consistency.trycloudflare.com/scanner


#      https://requires-ny-force-lift.trycloudflare.com/scanner

DB_PATH = "server/data/openfoodfacts.db"

api_key = "one-rgs iodesftheontisissihdebeten thncstthinciree wholeswedissh-ek-"

scheduler = AsyncIOScheduler()


device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.con = duckdb.connect(DB_PATH)
    logger.info("DuckDB connection opened")

    net = food_classifier.create_net(num_classes=206)
    
    model_folder = food_classifier.get_relative_path()
    model_path = model_folder + "/" + "food_classifier_resnet50.pth"
    
    net.load_state_dict(torch.load(model_path, weights_only=True))
    net = net.to(device)
    app.state.net = net 

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
    
    subgroups = con.execute("select distinct subgroups from main.item_list where subgroups != '' ").fetchall()
    logger.info(f"this are subgroups being fetched: {subgroups}")
    
    return {"subgroups": subgroups}


@app.get("/fetch_classnames")
async def fetch_classnames(request: Request):
    logger.info(f"invoked fetch_classnames at {datetime.datetime.now()}")

    con = request.app.state.con
    
    classnames = con.execute("select distinct class from main.item_list where class != '' ").fetchall()
    logger.info(f"this are classnames being fetched: {classnames}")
    
    return {"classnames": classnames}
 
 
@app.get("/fetch_items")
async def fetch_items(request: Request, subgroups: Optional[str] = Query(None), classnames: Optional[str] = Query(None)):
    
    '''currently this api endpoint only supports one subgroup and one classname at best,
    but in future it shall be able to use them by using an array that is used by string splitting for a comma
    and string manipulation for the query'''
    
    logger.info(f"invoked fetch_items at {datetime.datetime.now()}")

    con = request.app.state.con
    
    if subgroups: 
        items = con.execute(f"select * from main.item_list where subgroups = '{subgroups}'").fetchall()    
        
    elif classnames:
        items = con.execute(f"select * from main.item_list where class = '{classnames}' ").fetchall()
        
    elif classnames and subgroups:
        items = con.execute(f"select * from main.item_list where subgroups = '{subgroups} and class = '{classnames}' ").fetchall()
        
    else:
        items = con.execute("select * from main.item_list").fetchall()

    return {"item_list": items}


@app.get("/add_ean_to_list/")
async def add_ean(
    request: Request,
    ean: Optional[str] = Query(None, min_length=8, max_length=14),
    subgroups: Optional[str] = Query(None),
    count: Optional[str] = Query(None),
    item_name: Optional[str] = Query(None)
):
    logger.info(f"invoked add_ean at {datetime.datetime.now()}")


    con = request.app.state.con
    
    if not ean and not item_name:
        raise Exception ("you have to supply the ean or the item_name and you havent supplied both")
    if not count:
        count = 1
    if not subgroups:
        subgroups = ""
    if ean and not item_name:        
        item_name = con.execute(f"select item_name from main.item_list where ean = '{ean}'").fetchone()[0]
    if item_name and not ean:
        ean = con.execute(f"select ean from main.item_list where item_name = '{item_name}' ").fetchone()[0]
    class_name = ""
    


    # the sent subs will be split by comma in the url
    # if subgroups:
    #     subgroups = subgroups[:-1]

    if not subgroups == " ":
        subgroups = subgroups.split(",")
    else:
        subgroups = ""

    logger.info(f"subgroups: {subgroups}")
    logger.info(f"item_name: '{item_name}'")

    done = False

    logger.info(f"we have gotten a request for this ean: {ean}")
    
    logger.info(f"about to query this: SELECT product_name FROM main.food where code = '{ean}'")

    product_name = con.execute(f"""
        SELECT product_name FROM main.food where code = '{ean}'
    """).fetchall()
    logger.info(f"product_name: {product_name}")

    subgroups_string = ""
    
    same_items = con.execute(f"select item_name from main.item_list where item_name = '{item_name}' ").fetchall()
    if len(same_items) == 0:
        con.execute(
            "INSERT INTO main.item_list (ean, item_name, subgroups, class, count) VALUES (?, ?, ?)",
            (ean, product_name, subgroups_string, class_name, count),
        )
    else:
        con.execute(f"""UPDATE main.item_list 
                    SET count = count + {count} 
                    WHERE item_name = '{item_name}'; """)
        
        con.execute("delete from main.item_list where count < 1")
        
    done = True

    return {"ean": ean, "product_name": product_name, "done": done, "subgroups": ""}


async def food_name_classifier(sleep_intervall=60*60):
    con = duckdb.connect(DB_PATH)
    logger.info("[Background task] Connection opened")

    try:
        while True:
            try:
                logger.info(f"[{datetime.datetime.now()}] food_classifier task running...")
                '''
                item_names = con.execute("SELECT item_name FROM main.item_list where class is NULL").fetchall()
                
                for name in item_names:
                    classname = cl.classify(name)
                    con.execute(f"update main.item_list set class='{classname}' where item_name = '{name}'").fetchall()
                    '''
                    
                time.sleep(sleep_intervall)
            except Exception as e:
                logger.info(f"[food_classifier task error]: {e}")

    finally:
        con.close()
        logger.info("food_classifier Connection closed")


@app.post("/send_inference_image")
async def create_upload_file(image: UploadFile | None = None):
    if not image:
        logger.info("we havent received any image at all")
        return {"message": "No upload file sent"}
    else:
        logger.info(f"we have gotten the image with this name {image.filename}")
        
        with open("image.jpg", "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
            
        logger.info("Image saved to: image.jpg")
            
        image = "/Users/bennetjollenbeck/Desktop/programming/web/react/family_projects/grocery-list2/server/image.jpg"
        probablity, prediciton = food_classifier.run_inference(image, app.state.net)
        return {"predicition": prediciton, "probablity": probablity}
    
    
if __name__ == "__main__":
    
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=3030,
        reload=False,
        workers=1,
        loop="uvloop",
        http="httptools",
    )
