from fastapi import HTTPException
from httpx import Request
import requests
import asyncio



def constructFetchUrlOpenfood(ean: str | int) -> str:
    if isinstance(ean, int):
        ean = str(ean)  
    return f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=product_name"
    
async def getProduct(request: Request, ean: str, item_name: str, useDbDump: bool = False) -> tuple[str, str, bool]:
    if useDbDump:
        async with request.app.state.pool.acquire() as con:
            if ean and not item_name:
                # Fixed: reduced indentation
                row = await con.fetchrow(
                    "SELECT item_name FROM item_list WHERE ean = $1 LIMIT 1", ean
                )
                if row:
                    resolved_item_name = row['item_name']
                else:
                    row = await con.fetchrow(
                        "SELECT product_name FROM food WHERE code = $1 LIMIT 1", ean
                    )
                    if row:
                        resolved_item_name = row['product_name']
                    else:
                        raise HTTPException(status_code=404, detail=f"Item not found for EAN: {ean}")
                            
            existing = await con.fetchrow(
                "SELECT count, timestamps FROM item_list WHERE item_name = $1",
                resolved_item_name
            )
        return (ean, resolved_item_name, existing)
    
    else:
        resp: requests.Response = requests.get(url=constructFetchUrlOpenfood(ean))
        if resp.status_code == 200:
            jsonResp = resp.json()
            resolved_item_name: str = jsonResp["product"]["product_name"]
            existing = True
        else:
            resolved_item_name = ""  # Provide default value
            existing = False
        print(f"api request yielded this: {(ean, resolved_item_name, existing)}")  # Moved inside if block
        return (ean, resolved_item_name, existing)

asyncio.run(getProduct(request=Request(method="", url=""), ean="0180411000803", item_name=""))