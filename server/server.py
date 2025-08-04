# server.py
import datetime
import shutil
import duckdb
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request, UploadFile
import uvicorn

from fastapi.responses import PlainTextResponse

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from classification import classifier as cl

from food_classifier.main import run_inference

from prometheus_fastapi_instrumentator import Instrumentator

import time

#   https://swedish-desire-derek-consistency.trycloudflare.com/scanner


#      https://requires-ny-force-lift.trycloudflare.com/scanner

DB_PATH = "data/openfoodfacts.db"

api_key = "one-rgs iodesftheontisissihdebeten thncstthinciree wholeswedissh-ek-"

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.con = duckdb.connect(DB_PATH)
    print("DuckDB connection opened")

    scheduler.add_job(food_classifier, CronTrigger(hour="*/2", minute=0))
    scheduler.start()

    yield

    scheduler.shutdown()

    app.state.con.close()
    print("DuckDB connection closed")


app = FastAPI(lifespan=lifespan)

Instrumentator().instrument(app).expose(app)


@app.middleware("http")
async def protect_metrics(request: Request, call_next):
    if request.url.path == "/metrics":
        print(f"received metrics request at this time: {datetime.datetime.now()}")

        auth_header = request.headers.get("Authorization")


        if not auth_header or not auth_header.startswith("Bearer "):
            return PlainTextResponse("Unauthorized", status_code=401)

        token = auth_header.removeprefix("Bearer ").strip()

        if token != api_key:
            print(f"Provided token: '{token}', expected: '{api_key}'")
            return PlainTextResponse("Unauthorized", status_code=401)

    return await call_next(request)



@app.get("/fetch_items")
async def get_items(request: Request):
    print(f"invoked at {datetime.datetime.now()}")

    con = request.app.state.con
    items = con.execute("select * from main.item_list").fetchall()

    return {"item_list": items}


@app.get("/add_ean_to_list/")
async def add_ean(
    request: Request,
    ean: str = Query(..., min_length=8, max_length=14),
    subgroups: str = Query(
        ...,
    ),
):
    print(f"invoked at {datetime.datetime.now()}")

    # the sent subs will be split by comma in the url
    # if subgroups:
    #     subgroups = subgroups[:-1]

    if not subgroups == " ":
        subgroups = subgroups.split(",")
    else:
        subgroups = ""

    print(f"subgroups: {subgroups}")

    done = False

    print(f"we have gotten a request for this ean: {ean}")

    con = request.app.state.con
    product_name = con.execute(f"""
        SELECT product_name FROM main.food where code = '{ean}'
    """).fetchall()
    print(f"product_name: {product_name}")

    subgroups_string = ""

    con.execute(
        "INSERT INTO main.item_list (ean, item_name, subgroups) VALUES (?, ?, ?)",
        (ean, product_name, subgroups_string),
    )

    done = True

    return {"ean": ean, "product_name": product_name, "done": done, "subgroups": ""}


@app.get("/remove_item/")
async def remove_item(
    request: Request,
    text: str = Query(
        ...,
    ),
    parent: str = Query(
        ...,
    ),
):
    con = request.app.state.con

    print(f"Attempting to delete item with text: '{text}' and parent: '{parent}'")

    


async def food_classifier(sleep_intervall=60*60):
    con = duckdb.connect(DB_PATH)
    print("[Background task] Connection opened")

    try:
        while True:
            try:
                print(f"[{datetime.datetime.now()}] food_classifier task running...")
                item_names = con.execute("SELECT item_name FROM main.item_list where class is NULL").fetchall()
                
                '''for name in item_names:
                    classname = cl.classify(name)
                    con.execute(f"update main.item_list set class='{classname}' where item_name = '{name}'").fetchall()'''
                    
                time.sleep(sleep_intervall)
            except Exception as e:
                print(f"[food_classifier task error]: {e}")

    finally:
        con.close()
        print("food_classifier Connection closed")


@app.post("/send_inference_image")
async def create_upload_file(image: UploadFile | None = None):
    if not image:
        print("we havent received any image at all")
        return {"message": "No upload file sent"}
    else:
        print(f"we have gotten the image with this name {image.filename}")
        
        with open("image.jpg", "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
        print("Image saved to: image.jpg")
            
            
        run_inference(image)
        return {"filename": image.filename}
    
    
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
