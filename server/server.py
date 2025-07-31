# server.py
import duckdb
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request
import uvicorn

#   https://swedish-desire-derek-consistency.trycloudflare.com/scanner


#      https://requires-ny-force-lift.trycloudflare.com/scanner

DB_PATH = "data/openfoodfacts.db"

@asynccontextmanager
async def lifespan(app: FastAPI):

    app.state.con = duckdb.connect(DB_PATH)
    print("DuckDB connection opened")
    yield

    app.state.con.close()
    print("DuckDB connection closed")


app = FastAPI(lifespan=lifespan)



@app.get("/fetch_items")
async def get_items(request: Request):
    con = request.app.state.con
    items = con.execute("select * from main.item_list").fetchall()
    
    print(f"items: {items}")
    return {"item_list": items}



@app.get("/add_ean_to_list/")
async def add_ean(request: Request, ean: str = Query(..., min_length=8, max_length=14), subgroups: str = Query(...,)):
    
    #the sent subs will be split by comma in the url
    
    subgroups = subgroups.split(",")
    done = False
    
    print(f"we have gotten a request for this ean: {ean}")
    
    con = request.app.state.con
    product_name = con.execute(f"""
        SELECT product_name FROM main.food where code = '{ean}'
    """).fetchall()
    print(f"product_name: {product_name}")
    
    subgroups_string = ""
    for group in subgroups:
        subgroups_string += group + " "
    
    con.execute("INSERT INTO main.item_list (ean, item_name, subgroups) VALUES (?, ?, ?)", (ean, product_name, subgroups_string))
    
    done = True
    
    return {"ean": ean, "product_name": product_name, "done": done, "subgroups": ""}


if __name__ == "__main__":       
        
    uvicorn.run(
        "server:app",
        host="127.0.0.1",
        port=3030,
        reload=False,            
        workers=1,
        loop="uvloop",            
        http="httptools",        
    )
