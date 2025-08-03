# server.py
import datetime
import duckdb
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request
import uvicorn

from fastapi.responses import PlainTextResponse

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from classification import classifier as cl

from prometheus_fastapi_instrumentator import Instrumentator



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
    for group in subgroups:
        if subgroups.index(group) != len(subgroups) - 1:
            subgroups_string += group + ","
        else:
            subgroups_string += group

    print(f"subgroups_string: {subgroups_string}")

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

    try:
        # First, let's see what's actually in the database for debugging
        debug_query = """
            SELECT item_name, subgroups 
            FROM main.item_list
            WHERE subgroups LIKE ?
        """
        debug_results = con.execute(debug_query, (f"%{parent}%",)).fetchall()
        print(f"All items with parent '{parent}':")
        for item in debug_results:
            print(f"  - '{item[0]}' in subgroups '{item[1]}'")

        # Try to match with both regular and escaped quotes, and with/without brackets
        escaped_text = text.replace("'", "\\'")  # Pre-escape the text
        text_variants = [
            text,  # Original text
            escaped_text,  # Escaped single quotes
            text.replace("\\'", "'"),  # Unescaped single quotes
            f"[[{text}]]",  # With double brackets
            f"[['{text}']]",  # With double brackets and single quotes
            f"[[{escaped_text}]]",  # With double brackets and escaped quotes
        ]

        items_before = 0
        matching_text = None

        # Check each variant to find a match
        for variant in text_variants:
            check_query = """
                SELECT COUNT(*) as count
                FROM main.item_list
                WHERE item_name = ? AND subgroups LIKE ?
            """
            existing_items = con.execute(
                check_query, (variant, f"%{parent}%")
            ).fetchall()
            count = existing_items[0][0] if existing_items else 0
            print(f"Checking variant '{variant}': found {count} items")

            if count > 0:
                items_before = count
                matching_text = variant
                break

        print(
            f"Found {items_before} matching items before deletion using text: '{matching_text}'"
        )

        if items_before == 0:
            return {
                "success": False,
                "message": f"No items found with text '{text}' and parent '{parent}'. Available items: {[item[0] for item in debug_results]}",
                "items_deleted": 0,
                "items_before": 0,
                "items_after": 0,
            }

        # Perform the deletion using the matching text variant
        delete_query = """
            DELETE FROM main.item_list
            WHERE item_name = ? AND subgroups LIKE ?                
        """
        con.execute(delete_query, (matching_text, f"%{parent}%"))

        # Verify deletion by counting remaining items
        check_query = """
            SELECT COUNT(*) as count
            FROM main.item_list
            WHERE item_name = ? AND subgroups LIKE ?
        """
        remaining_items = con.execute(
            check_query, (matching_text, f"%{parent}%")
        ).fetchall()
        items_after = remaining_items[0][0] if remaining_items else 0

        items_deleted = items_before - items_after

        print(f"Deletion complete: {items_deleted} items deleted")
        print(f"Items before: {items_before}, Items after: {items_after}")

        if items_deleted > 0:
            return {
                "success": True,
                "message": f"Successfully deleted {items_deleted} item(s) with text '{matching_text}' and parent '{parent}'",
                "items_deleted": items_deleted,
                "items_before": items_before,
                "items_after": items_after,
                "matched_text": matching_text,
            }
        else:
            return {
                "success": False,
                "message": "No items were deleted. This might indicate a database issue.",
                "items_deleted": 0,
                "items_before": items_before,
                "items_after": items_after,
            }

    except Exception as e:
        print(f"Error deleting item: {e}")
        return {
            "success": False,
            "error": str(e),
            "message": "Database error occurred while trying to delete item",
        }


async def food_classifier():
    con = duckdb.connect(DB_PATH)
    print("[Background task] Connection opened")

    try:
        while True:
            try:
                print(f"[{datetime.datetime.now()}] food_classifier task running...")
                item_names = con.execute("SELECT item_name FROM main.item_list where class is NULL").fetchall()
                
                for name in item_names:
                    classname = cl.classify(name)
                    con.execute(f"update main.item_list set class='{classname}' where item_name = '{name}'").fetchall()
                    

            except Exception as e:
                print(f"[food_classifier task error]: {e}")

    finally:
        con.close()
        print("food_classifier Connection closed")


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
