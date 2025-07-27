# server.py
import duckdb
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request
import uvicorn


DB_PATH = "data/openfoodfacts.db"

@asynccontextmanager
async def lifespan(app: FastAPI):

    app.state.con = duckdb.connect(DB_PATH)
    print("DuckDB connection opened")
    yield

    app.state.con.close()
    print("DuckDB connection closed")


app = FastAPI(lifespan=lifespan)

@app.get("/")
async def read_root(request: Request):
    
    #use this to get info about the names of the columns: DESCRIBE main.food;
    #code is the ean
    ean = "5411188128601"
    columns = request.app.state.con.execute(f"""
        SELECT code, product_name FROM main.food where code = '{ean}'
    """).df() 
    print(columns.head())

    return {"message": columns}



@app.get("/get_info/")
async def get_info(request: Request, ean: str = Query(..., min_length=8, max_length=14)):
    con = request.app.state.con
    cur = con.execute("SELECT * FROM food WHERE ean = ?", (ean,))
    row = cur.fetchone()
    return {"ean": ean, "row": row}


if __name__ == "__main__":       
        
    uvicorn.run(
        "server:app",
        host="127.0.0.1",
        port=8000,
        reload=False,             # True = auto-reload on code changes (dev only)
        workers=1,
        loop="uvloop",            # Faster event loop (if available)
        http="httptools",         # Fast HTTP parser
    )
