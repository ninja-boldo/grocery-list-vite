import asyncio
import json
import logging
import traceback
from typing import Optional

from fastapi import APIRouter, Query, Request, HTTPException, status

from utils.api_helpers import (
    getCurrentPantryListUserPydantic,
    getCurrentWishHashForUser,
    getUsernameFromReq,
    getIdFromUsername,
    cleanupStaleWishMappings,
    addItemToInventory,
    reformatTimeStamp,
    validate_wish_list,
)
from utils.query_builder import build_fetch_query
from utils.types_custom import (
    AddEanRequest,
    AddFetchedItems,
    FetchItemsResponse,
    Item,
    ClassificationWishListVsPantryInternal,
    InternalClassification,
    QuantityInfo,
)

router = APIRouter(prefix="", tags=["core"])


@router.get("/fetch_items")
async def fetch_items(
    request: Request,
    only_wish_list: Optional[str] = Query(None),
    sortOrder: Optional[str] = Query(None),
    skip: Optional[int] = Query(None),
    limit: Optional[int] = Query(None),
    searchQuery: Optional[str] = Query(None),
) -> FetchItemsResponse:
    username = getUsernameFromReq(request) or "benno"
    sortOrder = sortOrder.lower() if sortOrder else None

    logger = logging.getLogger("fastapi-logger")
    logger.info(
        "fetch_items: only_wish_list=%s, sortOrder=%s, searchQuery=%s, skip=%s, limit=%s",
        only_wish_list,
        sortOrder,
        searchQuery,
        skip,
        limit,
    )

    skip = max(skip, 0) if skip is not None else None
    limit = max(limit, 0) if limit is not None else None

    try:
        wish_hash: Optional[str] = None

        async with request.app.state.db.pool.acquire() as con:
            if only_wish_list == "true":
                user_id = await getIdFromUsername(con, username)
                if user_id:
                    asyncio.ensure_future(
                        cleanupStaleWishMappings(request.app.state.db.pool, user_id)
                    )
                    wish_hash = await getCurrentWishHashForUser(con, user_id)

            query, params = build_fetch_query(
                username,
                only_wish_list,
                sortOrder=sortOrder,
                skip=skip,
                limit=limit,
                searchQuery=searchQuery,
                wish_hash=wish_hash,
            )

            rows = await con.fetch(query, *params)

        items = [
            {
                "ean": row["ean"],
                "text": row["item_name"],
                "shortened_name": row["shortend_name"],
                "count": row["count"],
                "perish_dates": [
                    reformatTimeStamp(ts) for ts in (row["perish_dates"] or [])
                ],
                "imageUrl": row["image_url"]
                or "https://boldo.ddns.net/none_available.webp",
                "mappedItems": (
                    json.loads(row["mapped_items"])
                    if "mapped_items" in row.keys() and row["mapped_items"] is not None
                    else []
                )
                or [],
                "quantity": 
                    {
                        "product_quantity": row["amount"],
                        "product_quantity_unit": row["unit"],
                    }
                
                or None,
                "tags": row["class"] or "",
            }
            for row in rows
        ]

        print(f"returning these items: {json.dumps(items)}")

        return FetchItemsResponse.model_validate(
            {
                "status": status.HTTP_200_OK,
                "items": items,
                "distinct_items": len(items),
                "accumulated_count": sum(item["count"] for item in items),
            }
        )

    except Exception as e:
        logger.error("fetch_items error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch items")


@router.post("/add_ean_to_list/")
async def add_ean_to_list(request: Request, body: AddEanRequest):
    incoming_ean = (body.ean or "").strip()
    ean = incoming_ean or None

    incoming_item_name = (
        (body.item_name or "").strip() if body.item_name is not None else ""
    )
    item_name = (
        None
        if incoming_item_name.lower() in {"", "none", "null", "undefined"}
        else incoming_item_name
    )

    if not ean and not item_name:
        raise HTTPException(status_code=400, detail="Must supply ean or item_name")

    count_delta = int(body.count) if body.count is not None else 1
    is_wish = validate_wish_list(body.wish_list)

    logger = logging.getLogger("fastapi-logger")
    username = getUsernameFromReq(request)

    try:
        if count_delta == 0:
            return {
                "ean": ean,
                "product_name": item_name,
                "done": True,
                "known_to_db": "could not check",
                "mode": "ean" if ean else "manual adding",
                "operation": "nothing",
            }

        res = await addItemToInventory(
            request.app.state.http_client,
            request.app.state.pool,
            ean=ean,
            username=username,
            item_name=item_name,
            count=count_delta,
            quantity=body.quantity_data,
            is_wish=is_wish,
            logger=logger,
        )

        return {
            "ean": res.get("ean", ean),
            "product_name": res.get("product_name", item_name),
            "done": True,
            "known_to_db": res.get("known_to_db", True),
            "mode": res.get("mode", "ean" if ean else "manual adding"),
            "operation": res.get("operation", "unknown"),
            "error": res.get("error", "none"),
            "suggestion": res.get("suggestion", "none"),
            **({"quantity_needed": True} if res.get("quantity_needed") else {}),
        }

    except Exception as e:
        logger.error(f"add_ean_to_list failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to add item")


@router.post("/add_fetched_items")
async def add_fetched_items(request: Request, body: AddFetchedItems):
    from dateutil import parser

    username = getUsernameFromReq(request)
    logger = logging.getLogger("fastapi-logger")

    try:
        for item in body.items:
            for date, count in zip(item.perish_dates, item.per_date_count):
                await addItemToInventory(
                    request.app.state.http_client,
                    request.app.state.pool,
                    username=username,
                    ean=item.ean,
                    item_name=item.item_name,
                    count=count,
                    quantity=None,
                    is_wish=validate_wish_list(item.isWished),
                    date=parser.parse(date),
                    logger=logger,
                )

        return {"message": f"Synced {len(body.items)} items", "status": "success"}

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@router.get("/classify_items_against_pantry")
async def classify_items_against_pantry(
    request: Request,
    itemsWished: str = Query(...),
    autoAddItems: Optional[bool] = True,
):
    import json
    from pydantic import TypeAdapter, ValidationError

    logger = logging.getLogger("fastapi-logger")

    try:
        itemsExternal: list[Item] = TypeAdapter(list[Item]).validate_python(
            json.loads(itemsWished)
        )
    except (json.JSONDecodeError, ValidationError) as e:
        logger.error(f"failed json decoding in classifyItemsAgainstPantryEndpoint: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid itemsWished payload: {e}",
        )

    try:
        username = getUsernameFromReq(request)
        logger.warning(f"got this username: {username}")
    except Exception as e:
        logger.error(f"failed Authentication: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {e}",
        )

    try:
        from transcript_classify import classifier as classifier_module

        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            pantry: list[Item] = await getCurrentPantryListUserPydantic(con, uid)

            mapping: list[
                InternalClassification
            ] = await classifier_module.classifyWishAgainstPantry(
                con, pantry, itemsExternal, uid
            )

    except Exception as e:
        logger.error(f"failed classification: {traceback.format_exception(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Classification failed: {e}",
        )

    jsonMapping = [m.model_dump() for m in mapping]
    res = []
    for js in jsonMapping:
        mappedWish = js.get("mappedWishItem")
        isWishMapped = js.get("foundMappingWish")
        if mappedWish is not None and isWishMapped is not False:
            res.append(js)

    if autoAddItems:
        from utils.api_helpers import addNonClassifiedWishes

        parsedClassification = ClassificationWishListVsPantryInternal(mappings=res)
        await addNonClassifiedWishes(
            request.app.state.pool, uid, parsedClassification, itemsExternal
        )

    return {
        "message": f"Success for user {uid}",
        "status": "success",
        "mapping": res,
    }
