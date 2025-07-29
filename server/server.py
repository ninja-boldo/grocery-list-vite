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
    ean = "4260596131663"
    answer = request.app.state.con.execute(f"""
        SELECT code, product_name FROM main.food where code = '{ean}'
    """).df() 

    return {"result": answer}



@app.get("/add_ean_to_list/")
async def get_info(request: Request, ean: str = Query(..., min_length=8, max_length=14)):
    
    done = False
    
    print(f"we have gotten a request for this ean: {ean}")
    
    con = request.app.state.con
    answer = con.execute(f"""
        SELECT product_name FROM main.food where code = '{ean}'
    """).fetchall()
    print(f"answer: {answer}")
    
    done = True
    
    return {"ean": ean, "row": answer, "done": done}


# @app.get("/item_list")
# async def get_items(request: Request):
    



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
