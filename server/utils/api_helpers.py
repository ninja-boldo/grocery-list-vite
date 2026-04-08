import asyncio
import base64
from datetime import datetime
import json
import logging
import os
import traceback
from typing import Any, Optional
from zoneinfo import ZoneInfo

import datetime as dt
import asyncpg
from dateutil import parser
from fastapi import Request
import httpx
import requests
import re
import hashlib

from supermarkets.classifier import CatalogueClassifier
from utils.password_helper import verify_token
from utils.types import (
    AddCatalogueRequest,
    AddSupermarketRequest,
    Ingredient,
    ItemInfo,
    ItemInfoParsed,
    Offer,
    QuantityInfo,
    AddRecipe,
)


def convert_timestamps_to_dates(timestamps_json: str) -> list[str]:
    """Convert ISO timestamps to DD.MM.YYYY strings."""
    try:
        timestamps = json.loads(timestamps_json or "[]")
        return [
            datetime.fromisoformat(ts).date().strftime("%d.%m.%Y") for ts in timestamps
        ]
    except (json.JSONDecodeError, ValueError):
        return []


def safe_int(value: Any, default: int = 1) -> int:
    """Safely convert value to int."""
    try:
        return int(value) if value is not None else default
    except (ValueError, TypeError):
        return default


def sanitize_string(value: Optional[str], default: str = "") -> str:
    """Strip input or return default."""
    return (value or default).strip()


def sanitizeDeprecationDays(DeprecationDays: int | None, default: int = 30) -> int:
    if DeprecationDays is None:
        raw_deprecation_days = os.getenv("DEPRECATION_DAYS_CATALOGUE", default)
        try:
            DeprecationDays = int(raw_deprecation_days)
        except ValueError:
            DeprecationDays = 30
    return DeprecationDays


def validate_wish_list(value: Optional[str]) -> bool:
    """Normalize wish_list to 'true' or 'false'."""
    if not value:
        return False
    if value.strip().lower() == "true":
        return True
    return False


async def obtainSupermarketId(
    con: asyncpg.pool.PoolConnectionProxy,
    body: AddCatalogueRequest,
    maxDerivationCoord: float = 0.00001,
) -> int | dict:
    # 0,0001 * 111_000 = 11,1 => max derivation is 11,1 meters
    if isCatolgueBodyValid(body):
        coordsSet = body.longitude is not None and body.latitude is not None
        otherMarkerSet = body.address is not None and (
            body.city is not None or body.postcode is not None
        )
        supermarketId = None
        if coordsSet:
            maxLong = body.longitude + maxDerivationCoord  # type: ignore
            minLong = body.longitude - maxDerivationCoord  # type: ignore
            maxLat = body.latitude + maxDerivationCoord  # type: ignore
            minLat = body.latitude - maxDerivationCoord  # type: ignore

            supermarketId = await con.fetch(
                """select supermarket_id from supermarkets where longitude >= $1 and longitude <= $2
                                            and latitude >= $3 and latitude <= $4""",
                minLong,
                maxLong,
                minLat,
                maxLat,
            )
            supermarketId = supermarketId[0]

        elif otherMarkerSet:
            supermarketId = await con.fetch(
                "select supermarket_id from supermarkets where address = $1",
                body.address.strip(),  # type: ignore
            )  # type: ignore
            supermarketId = supermarketId[0]

        if not supermarketId:
            return {
                "status": "error",
                "detail": "couldnt not match to market, neither by coordinates nor by address",
            }

        return supermarketId.get("supermarket_id")
    else:
        return {
            "status": "error",
            "detail": "the body doesnt seem to have enough geo information for market matching",
        }


async def getUserIds(con: asyncpg.pool.PoolConnectionProxy) -> list[int]:
    res = await con.fetch("select distinct(user_id) as uid from inventory")
    return [int(r["uid"]) for r in res]


async def getAllUserItems(
    con: asyncpg.pool.PoolConnectionProxy,
) -> dict[int, dict[str, dict]]:
    """Fetch all users' inventory in a single query. Returns {user_id: {'wish': {...}, 'pantry': {...}}}"""
    res = await con.fetch(
        """select inv.user_id, inv.item_id, it.item_name, inv.is_wish 
           from inventory inv 
           join items it on it.item_id = inv.item_id"""
    )
    users: dict[int, dict[str, dict]] = {}
    for r in res:
        uid = int(r["user_id"])
        if uid not in users:
            users[uid] = {"wish": {}, "pantry": {}}
        if r["is_wish"]:
            users[uid]["wish"][r["item_id"]] = r["item_name"]
        else:
            users[uid]["pantry"][r["item_id"]] = r["item_name"]
    return users


async def getAllExistingMappings(
    con: asyncpg.pool.PoolConnectionProxy,
) -> set[tuple[str, str]]:
    """Get all existing (wish_list_hash, pantry_list_hash) combinations that have been mapped."""
    res = await con.fetch(
        "select distinct wish_list_hash, pantry_list_hash from wish_mapping"
    )
    return {(r["wish_list_hash"], r["pantry_list_hash"]) for r in res}


async def getCurrentWishListUser(
    con: asyncpg.pool.PoolConnectionProxy, user_id: int
) -> dict:
    res = await con.fetch(
        """select inv.item_id as item_id, it.item_name as item_name 
           from inventory inv 
           join items it on it.item_id = inv.item_id 
           where inv.user_id = $1 and inv.is_wish = true""",
        user_id,
    )
    return {r["item_id"]: r["item_name"] for r in res}


async def getCurrentPantryListUser(
    con: asyncpg.pool.PoolConnectionProxy, user_id: int
) -> dict:
    res = await con.fetch(
        """select inv.item_id as item_id, it.item_name as item_name 
           from inventory inv 
           join items it on it.item_id = inv.item_id 
           where inv.user_id = $1 and inv.is_wish = false""",
        user_id,
    )
    return {r["item_id"]: r["item_name"] for r in res}


async def checkPartialCategorisation(
    con: asyncpg.pool.PoolConnectionProxy,
    wishHash: str,
    pantryHash: str,
) -> dict[tuple[str, str], dict[str, dict]]:
    """Return all pantry items that need categorisation, keyed by (wish_hash, pantry_hash)."""
    res = await con.fetch(
        """select inv.user_id, inv.item_id, it.item_name, wm.wish_list_hash, wm.pantry_list_hash
           from inventory inv 
           join items it on it.item_id = inv.item_id 
           left join wish_mapping wm on wm.item_id = inv.item_id 
           where inv.is_wish = false 
           and wm.item_id is not null"""
    )
    result: dict[tuple[str, str], dict[str, dict]] = {}
    for r in res:
        key = (r["wish_list_hash"], r["pantry_list_hash"])
        if key not in result:
            result[key] = {}
        result[key][r["item_id"]] = r["item_name"]
    return result


async def buildWishPantryLists(
    con, sinkLabel: str | None = None
) -> tuple[list[str], list[list[str]], dict, list[tuple[str, str]]]:
    queryMapping = await getStateAwareLists(con)
    return craftWishItemLists(queryMapping, sinkLabel)


async def getStateAwareLists(con: asyncpg.pool.PoolConnectionProxy):
    all_users_items = await getAllUserItems(con)
    existing_mappings = await getAllExistingMappings(con)

    classifyMap: dict = {}

    for user_id, user_data in all_users_items.items():
        currentPantryListDict: dict = user_data["pantry"]
        currentWishListDict: dict = user_data["wish"]

        wishHash: str = hashListState(list(currentWishListDict.values()))
        pantryHash: str = hashListState(list(currentPantryListDict.values()))

        if (wishHash, pantryHash) not in existing_mappings:
            classifyMap[user_id] = {
                "pantry": currentPantryListDict,
                "wish": list(currentWishListDict.values()),
                "wish_ids": currentWishListDict,
                "wish_hash": wishHash,
                "pantry_hash": pantryHash,
            }

    return classifyMap


def craftWishItemLists(
    queryMapping: dict, sinkLabel: str | None = None
) -> tuple[list[str], list[list[str]], dict, list[tuple[str, str]]]:
    item_to_id = {}

    if sinkLabel:
        item_to_id[sinkLabel] = generateManualItemId(sinkLabel)

    item_names = []
    wished_lists = []
    hash_per_item = []

    for user_id in queryMapping.keys():
        userDict = queryMapping.get(user_id, {})
        pantry_items = userDict.get("pantry", {})
        wish_list = userDict.get("wish", [])
        wish_ids = userDict.get("wish_ids", {})
        wish_hash = userDict.get("wish_hash", "")
        pantry_hash = userDict.get("pantry_hash", "")

        # Add wish item names -> IDs to the mapping
        for item_id, item_name in wish_ids.items():
            item_to_id[item_name] = item_id

        if sinkLabel:
            wish_list = wish_list + [sinkLabel]

        for item_id, item_name in pantry_items.items():
            item_names.append(item_name)
            item_to_id[item_name] = item_id
            wished_lists.append(wish_list)
            hash_per_item.append((wish_hash, pantry_hash))

    return item_names, wished_lists, item_to_id, hash_per_item


async def addOffersBatch(
    con: asyncpg.pool.PoolConnectionProxy,
    offers: list[Offer],
    supermarketId: int,
    logger: logging.Logger,
):
    try:
        offerTuples: list[tuple] = []
        currentTime: datetime = datetime.now()
        for offer in offers:
            offerTuples.append(
                (
                    offer.name,
                    offer.normal_price,
                    offer.discount_price,
                    supermarketId,
                    offer.is_app_offer,
                    currentTime,
                    str(offer.weight_g),
                    str(offer.volume_ml),
                    offer.shortened_name,
                )
            )

        logger.info(f"trying to add these offers to the db: {offerTuples}")
        await con.executemany(
            """
            insert into grocery_offers(item_name, original_price, offer_price, supermarket_id, is_app_offer, added_at, weight_g, volume_ml, shortened_name)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """,
            offerTuples,
        )

    except Exception as e:
        raise Exception(f"failed with this error: {e}")


def convertAddressToCoordinates(address: str, city: str):
    try:
        compAdressRaw: str = f"{address}, {city}"

        params: dict = {"q": compAdressRaw, "limit": 1, "lang": "de"}
        res = requests.get(
            "https://photon.komoot.io/api",
            params=params,
            timeout=8,
            headers={"User-Agent": "grocery-app/1.0"},
        )
        res.raise_for_status()
        payload = res.json()

        features = payload.get("features", [])
        if not features:
            return {
                "status": "error",
                "message": "No matching location found for the provided address",
                "code": "404",
            }

        top_hit = features[0]
        properties = top_hit.get("properties", {})
        geometry = top_hit.get("geometry", {})
        coordinates = geometry.get("coordinates", [])

        if len(coordinates) < 2:
            return {
                "status": "error",
                "message": "Geocoding service did not return valid coordinates",
                "code": "500",
            }

        street = properties.get("street")
        house_number = properties.get("housenumber")
        formatted_address = f"{street} {house_number}".strip() if street else address

        return {
            "postcode": properties.get("postcode"),
            "city": properties.get("city") or city,
            "name": properties.get("name"),
            "address": formatted_address,
            "longitude": float(coordinates[0]),
            "latitude": float(coordinates[1]),
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


def isCatolgueBodyValid(body: AddCatalogueRequest) -> bool:
    coordsSet = body.longitude is not None and body.latitude is not None
    otherMarkerSet = body.address is not None and (
        body.city is not None or body.postcode is not None
    )

    return coordsSet or otherMarkerSet


def isAddSupermarketBodyValid(body: AddSupermarketRequest) -> bool:
    coordsSet = body.longitude is not None and body.latitude is not None
    otherMarkerSet = body.address is not None and (
        body.city is not None or body.postcode is not None
    )

    return coordsSet or otherMarkerSet


async def classifyCatalogue(
    pool: asyncpg.Pool,
    classifier: CatalogueClassifier,
    body: AddCatalogueRequest,
    filepath: str,
    logger: logging.Logger,
):
    try:
        if isCatolgueBodyValid(body) and filepath.strip() != "":
            response = classifier.classify_catalogue(filepath)
            async with pool.acquire() as con:
                supermarketId: int | dict = await obtainSupermarketId(con, body)
                if isinstance(supermarketId, dict):
                    logger.error(f"""couldnt classify the catologue with filepath: {filepath},
                                cause there wasnt enough info to be obtained for marktet matching: {supermarketId}""")
                elif isinstance(supermarketId, int):
                    await addOffersBatch(
                        con, response.offers, supermarketId, logger=logger
                    )
        else:
            logger.error(
                "the body doesnt seem to have enough geo information for market matching"
            )
            return {
                "status": "error",
                "detail": "the body doesnt seem to have enough geo information for market matching",
            }
    except Exception as e:
        logger.error(f"failed for catalogue: {filepath} with this error: {e}")


def reformatTimeStamp(ts, fmt="%d.%m.%Y"):
    if isinstance(ts, list):
        ts = ts[0]
    if isinstance(ts, dt.datetime):
        return ts.strftime(fmt)
    return parser.parse(str(ts)).strftime(fmt)


def convertToBerlinTime(
    currentDatetime: dt.datetime | None, tz: ZoneInfo = ZoneInfo("Europe/Berlin")
) -> dt.datetime:
    if currentDatetime is None:
        return dt.datetime.now()
    else:
        if currentDatetime.tzinfo is None:
            newDatetime = currentDatetime.replace(tzinfo=tz)
        else:
            newDatetime = currentDatetime.astimezone(tz)
        return newDatetime


async def itemInStock(con: asyncpg.pool.PoolConnectionProxy, userId: int, ean: str):
    res = await con.fetch(
        "select item_id from inventory where user_id = $1 and item_id = $2", userId, ean
    )
    return len(res) > 0


async def itemIsKnown(con: asyncpg.pool.PoolConnectionProxy, ean: str | None) -> bool:
    if ean is None:
        return False
    res = await con.fetch("select item_id from items where item_id = $1", ean)
    return len(res) > 0


async def resolveExistingEanFromName(
    con: asyncpg.pool.PoolConnectionProxy,
    userId: int,
    item_name: str,
) -> str | None:
    # Prefer item IDs that already exist in the current user's inventory.
    user_owned_ean = await con.fetchval(
        """
        SELECT inv.item_id
        FROM inventory inv
        JOIN items it ON it.item_id = inv.item_id
        WHERE inv.user_id = $1
          AND lower(COALESCE(it.item_name, '')) = lower($2)
          AND inv.item_id NOT LIKE 'manual-%'
          AND inv.item_id NOT IN ('-1', '0', '1')
        ORDER BY inv.created_at DESC NULLS LAST
        LIMIT 1
        """,
        userId,
        item_name,
    )
    if user_owned_ean:
        return user_owned_ean

    # Fallback to any canonical item ID for this name.
    global_ean = await con.fetchval(
        """
        SELECT it.item_id
        FROM items it
        WHERE lower(COALESCE(it.item_name, '')) = lower($1)
          AND it.item_id NOT LIKE 'manual-%'
          AND it.item_id NOT IN ('-1', '0', '1')
        ORDER BY it.last_checked_at DESC NULLS LAST
        LIMIT 1
        """,
        item_name,
    )
    return global_ean


def getUsernameFromReq(request: Request):
    authHeader = request.headers.get("Authorization", "none")
    username = verify_token(authHeader)
    return username.lower() if username else None


def hashListState(
    wish_list: list[str], encode_b64: bool = True, byte_len: int = 6
) -> str:
    wish_list_str = ",".join(sorted(wish_list))
    h = hashlib.blake2b(wish_list_str.encode(), digest_size=byte_len)
    if encode_b64:
        return base64.urlsafe_b64encode(h.digest()).decode()  # urlsafe: no +/
    return h.hexdigest()


async def insertIngredientAndMap(
    con: asyncpg.pool.PoolConnectionProxy, recipe_id: int, ing: Ingredient
) -> None:
    ing_id = await con.fetchval(
        """
        INSERT INTO ingredients (name, amount, unit)
        VALUES ($1, $2, $3)
        RETURNING ingredient_id
        """,
        ing.name,
        ing.amount,
        ing.unit,
    )

    await con.execute(
        """
        INSERT INTO recipe_ingredient_map (recipe_id, ingredient_id, count)
        VALUES ($1, $2, $3)
        """,
        recipe_id,
        ing_id,
        ing.count,
    )


async def insertRecipe(
    con: asyncpg.pool.PoolConnectionProxy,
    userId: int,
    recipe: AddRecipe,
) -> int:
    recipe_id = await con.fetchval(
        """
        INSERT INTO recipes (user_id, base_time, default_portions, tags, steps, emoji)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING recipe_id
        """,
        userId,
        recipe.baseTime,
        recipe.baseServings,
        recipe.tags,
        recipe.steps,
        recipe.emoji,
    )

    async with con.transaction():
        for ing in recipe.Ingredients:
            await insertIngredientAndMap(con, recipe_id, ing)

    return recipe_id


async def addRecipeToDb(
    con: asyncpg.pool.PoolConnectionProxy, userId: int, recipe: AddRecipe
) -> dict:
    try:
        async with con.transaction():
            recipe_id = await insertRecipe(con, userId, recipe)
            for ing in recipe.Ingredients:
                await insertIngredientAndMap(con, recipe_id, ing)

        return {"status": "ok", "recipe_id": recipe_id}

    except Exception as e:
        return {"status": "error", "message": f"failed with this error: {e}"}


def handleUsernameNoneAfterAuth():
    return {
        "status": "error",
        "message": """
                        failed with this error: couldnt retrieve username although you authenticated correctly.
                        as this quite weird please open an issue with the failure code 245341432 for the server error 
                        as identifier. 
                        """,
        "code": "500",
    }


async def getIdFromUsername(
    con: asyncpg.pool.PoolConnectionProxy, username: str
) -> int:
    res = await con.fetchrow("select user_id from users where username = $1 ", username)
    if res is None:
        raise ValueError(
            f"the username {username} isnt existent in the db => no user id to retrieve"
        )
    userId = int(res.get("user_id") or -1)
    if userId == -1:
        raise Exception(f"couldnt find a user id for this username: {username}")
    return userId


def generateManualItemId(itemName: str) -> str:
    return "manual-" + hashlib.sha1(itemName.lower().strip().encode()).hexdigest()[:12]


async def handleManualItems(
    con: asyncpg.pool.PoolConnectionProxy,
    item_name: str,
    count: int,
    userId: int,
    is_wish: bool,
    quantity: QuantityInfo | None,
    date: dt.datetime,
    logger: logging.Logger,
) -> dict:

    item_id = generateManualItemId(item_name)
    try:
        if not quantity:
            quantity = QuantityInfo(product_quantity=-1, product_quantity_unit="none")
            """
            return {
                "state": "error",
                "operation": "add",
                "mode": "manual adding",
                "error": "there was no quantity data supplied for the given item",
                "suggestion": "ask the user for manual quantity entry data",
            }"""

        await con.execute(
            "INSERT INTO items (item_id, item_name, amount, unit) VALUES ($1, $2, $3, $4) ON CONFLICT (item_id) DO NOTHING",
            item_id,
            item_name,
            quantity.product_quantity,
            quantity.product_quantity_unit,
        )
        await con.execute(
            "INSERT INTO item_classification (item_id) VALUES ($1) ON CONFLICT (item_id) DO NOTHING",
            item_id,
        )

        await con.execute(
            """
                                INSERT INTO inventory (item_id, user_id, count, is_wish, created_at)
                                SELECT $1, $2, 1, $3, $4
                                FROM generate_series(1, $5)
                            """,
            item_id,
            userId,
            is_wish,
            date,
            count,
        )
        return {"state": "success", "operation": "add", "mode": "manual adding"}
    except Exception as e:
        logger.error(f"handleManualItems failed: {e}")
        logger.error(traceback.format_exc())
        return {
            "state": "error",
            "operation": "add",
            "mode": "manual adding",
            "error": str(e),
        }


def parseQuantityString(s: str) -> QuantityInfo | None:
    
    multi = re.search(
        r"(\d+)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|liter|litre|ltr|gr|gram|stück)\b",
        s,
        re.IGNORECASE,
    )
    if multi:
        count = int(multi.group(1))
        amount = float(multi.group(2).replace(",", "."))
        unit = multi.group(3).lower()
        return _normalise(count * amount, unit)

    # Fraction: ½l, ¼kg
    fraction = re.search(r"([½⅓¼¾⅔])\s*(kg|g|mg|l|ml|cl|stück)\b", s, re.IGNORECASE)
    if fraction:
        frac_map = {"½": 0.5, "⅓": 1 / 3, "¼": 0.25, "¾": 0.75, "⅔": 2 / 3}
        amount = frac_map[fraction.group(1)]
        return _normalise(amount, fraction.group(2).lower())

    # Standard: 500g, 1.5 l, 1,5l, 500 ML
    single = re.search(
        r"(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|liter|litre|ltr|gr|gram|stück)\b",
        s,
        re.IGNORECASE,
    )
    if single:
        amount = float(single.group(1).replace(",", "."))
        return _normalise(amount, single.group(2).lower())

    return None


def _normalise(amount: float, unit: str) -> QuantityInfo:
    ALIASES = {
        "liter": "l",
        "litre": "l",
        "ltr": "l",
        "gr": "g",
        "gram": "g",
        "grams": "g",
    }
    unit = ALIASES.get(unit, unit)

    if unit == "kg":
        return QuantityInfo(
            product_quantity=int(amount * 1000), product_quantity_unit="g"
        )
    elif unit == "l":
        return QuantityInfo(
            product_quantity=int(amount * 1000), product_quantity_unit="ml"
        )
    elif unit == "cl":
        return QuantityInfo(
            product_quantity=int(amount * 10), product_quantity_unit="ml"
        )
    else:
        return QuantityInfo(product_quantity=int(amount), product_quantity_unit=unit)


def normalizeItemInfo(itemInfo: ItemInfo | None) -> ItemInfoParsed:

    failedItemInfo: ItemInfoParsed = ItemInfoParsed(
        product_name="none",
        quantity=QuantityInfo(product_quantity=-1, product_quantity_unit="none"),
        failedData=True,
    )
    if not itemInfo:
        return failedItemInfo
    it = None
    if not (itemInfo.product_quantity or itemInfo.product_quantity_unit):
        if itemInfo.quantity:
            info: QuantityInfo | None = parseQuantityString(itemInfo.quantity)
            if not info:
                return failedItemInfo  # couldnt retrieve the info
            it = itemInfo
        else:
            return failedItemInfo  # couldnt retrieve the info
    else:
        it = itemInfo  # everything already fine

    if not it:
        return failedItemInfo
    parsedItem = ItemInfoParsed(
        product_name=it.product_name,
        quantity=QuantityInfo(
            product_quantity=it.product_quantity,
            product_quantity_unit=it.product_quantity_unit,
        ),
        failedData=False,
    )

    return parsedItem


async def addItemToInventory(
    http_client: httpx.AsyncClient,
    pool: asyncpg.Pool,
    username: str | None,
    ean: str | None,
    item_name: str | None,
    count: int,
    is_wish: bool,
    quantity: QuantityInfo | None,
    logger: logging.Logger,
    date: dt.datetime | None = None,
) -> dict:
    try:
        if not username:
            raise ValueError("the username shouldnt be none for this function call")

        if isinstance(ean, str):
            ean = ean.strip() or None

        if isinstance(item_name, str):
            stripped_item_name = item_name.strip()
            if stripped_item_name.lower() in {"", "none", "null", "undefined"}:
                item_name = None
            else:
                item_name = stripped_item_name

        if not ean and not item_name:
            return {
                "state": "error",
                "operation": "unknown",
                "error": "you need either the ean or the item name to be set",
            }

        dateNormalized = (
            convertToBerlinTime(date)
            if date
            else dt.datetime.now(ZoneInfo("Europe/Berlin"))
        )

        async with pool.acquire() as con:
            userId: int | None = await con.fetchval(
                "SELECT user_id FROM users WHERE username = $1", username
            )
            if userId is None:
                return {
                    "state": "error",
                    "operation": "unknown",
                    "error": f"user '{username}' not found",
                }

            if not ean and item_name:
                resolved_ean = await resolveExistingEanFromName(con, userId, item_name)
                if resolved_ean:
                    logger.info(
                        "Resolved missing ean from item_name for user %s: '%s' -> %s",
                        username,
                        item_name,
                        resolved_ean,
                    )
                    ean = resolved_ean

            if count >= 1:
                try:
                    logger.info("we are in count >= 1")

                    if not ean:
                        if not item_name:
                            return {
                                "state": "error",
                                "operation": "add",
                                "error": "manual add requires item_name",
                            }
                        return await handleManualItems(
                            con,
                            item_name,
                            count,
                            userId,
                            is_wish,
                            date=dateNormalized,
                            quantity=quantity,
                            logger=logger,
                        )
                    else:
                        itemKnown = await itemIsKnown(con, ean)
                        if not itemKnown and not item_name:
                            itemInfo: ItemInfo | None = await getInfoAsync(
                                http_client, ean=ean, logger=logger, delay=0.0
                            )

                            itemInfoParsed: ItemInfoParsed = normalizeItemInfo(itemInfo)

                            if itemInfoParsed.failedData is True:
                                if itemInfoParsed.product_name != "none":
                                    return {
                                        "state": "error",
                                        "operation": "add",
                                        "error": f"couldnt retrieve additonal info for {itemInfoParsed.product_name}",
                                        "suggestion": "perhaps query the user for the quantity",
                                    }
                                else:
                                    return {
                                        "state": "error",
                                        "operation": "add",
                                        "error": f"couldnt retrieve the item name for ean: {ean}",
                                        "suggestion": "add this item manually",
                                    }

                            item_name = itemInfoParsed.product_name

                        if isinstance(item_name, str):
                            stripped_item_name = item_name.strip()
                            if stripped_item_name.lower() in {
                                "",
                                "none",
                                "null",
                                "undefined",
                            }:
                                item_name = None
                            else:
                                item_name = stripped_item_name

                        if not itemKnown:
                            logger.info(f"got this item info: {itemInfo}")
                            await con.execute(
                                """
                                    INSERT INTO items (item_id, item_name, last_checked_at, amount, unit)
                                    VALUES ($1, $2, now(), $3, $4)
                                    ON CONFLICT (item_id) DO NOTHING
                                """,
                                ean,
                                item_name,
                                itemInfoParsed.quantity.product_quantity,
                                itemInfoParsed.quantity.product_quantity_unit,
                            )
                            await con.execute(
                                "INSERT INTO item_classification (item_id) VALUES ($1) ON CONFLICT (item_id) DO NOTHING",
                                ean,
                            )

                        await con.execute(
                            """
                            INSERT INTO inventory (item_id, user_id, count, is_wish, created_at)
                            SELECT $1, $2, 1, $3, $4
                            FROM generate_series(1, $5)
                        """,
                            ean,
                            userId,
                            is_wish,
                            dateNormalized,
                            count,
                        )

                        return {
                            "state": "success",
                            "operation": "add",
                            "mode": "ean",
                            "ean": ean,
                            "product_name": item_name,
                            "known_to_db": True,
                            "first_to_add_item": itemKnown,
                        }
                except Exception as e:
                    logger.error(f"addItemToInventory add branch failed: {e}")
                    logger.error(traceback.format_exc())
                    return {"state": "error", "operation": "add", "error": str(e)}

            elif count <= -1:
                try:
                    logger.info("we are in count <= -1")
                    import hashlib

                    effective_id = (
                        ean
                        if ean
                        else "manual-"
                        + hashlib.sha1(
                            (item_name or "").lower().strip().encode()
                        ).hexdigest()[:12]
                    )
                    if await itemInStock(con, userId, effective_id):
                        await con.execute(
                            """
                            DELETE FROM inventory WHERE ctid IN (
                                SELECT ctid FROM inventory
                                WHERE item_id = $1 AND user_id = $2
                                ORDER BY created_at ASC
                                LIMIT $3
                            )
                        """,
                            effective_id,
                            userId,
                            abs(count),
                        )
                    else:
                        logger.info("nothing deletable")
                    return {
                        "state": "success",
                        "operation": "delete",
                        "mode": "ean" if ean else "manual adding",
                        "ean": ean,
                        "product_name": item_name,
                    }
                except Exception as e:
                    logger.error(f"addItemToInventory delete branch failed: {e}")
                    logger.error(traceback.format_exc())
                    return {"state": "error", "operation": "delete", "error": str(e)}
            else:
                logger.info("we are in the else clause")
                return {
                    "state": "success",
                    "operation": "nothing",
                    "error": f"wont do anything for count {count}",
                }
    except Exception as e:
        logger.error(f"addItemToInventory failed with this error: {e}")
        return {"state": "error", "operation": "unknown", "error": str(e)}


async def getInfoAsync(
    client: httpx.AsyncClient, ean: str, logger: logging.Logger, delay: float = 0.5
) -> ItemInfo | None:
    try:
        await asyncio.sleep(delay)
        res = await client.get(
            f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=product_name,quantity,product_quantity,product_quantity_unit",
            timeout=5.0,
        )
        data = res.json()
        if not data["status_verbose"] == "product found":
            logger.error(f"couldnt resolve item name for ean {ean}")
            return None
        logger.warning(f"got this data: {data.get('product')}")
        parsed = ItemInfo.model_validate_json(json.dumps(data.get("product")))
        return parsed
    except Exception as e:
        raise Exception(f"failed with this error: {e}")


async def getImageUrlAsync(
    client: httpx.AsyncClient, ean: str, logger: logging.Logger, delay: float = 0.5
) -> str:
    try:
        if ean.__contains__("manual"):
            return ""
        await asyncio.sleep(delay)
        res = await client.get(
            f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=selected_images",
            timeout=5.0,
        )
        data = res.json()
        images = data["product"]["selected_images"]["front"]["display"]
        for lang in ("en", "de", "fr", "es"):
            if lang in images:
                return images[lang]
    except Exception as e:
        logger.error(f"Failed to fetch image for ean {ean}: {e}")
        return "https://boldo.ddns.net/none_available.webp"
    return ""
