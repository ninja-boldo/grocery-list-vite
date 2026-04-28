from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


import asyncio
import base64
from datetime import datetime, timezone
from itertools import chain
import json
import logging
import os
import traceback
from typing import Any, Literal, Optional
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
from utils.types_custom import (
    AddCatalogueRequest,
    AddSupermarketRequest,
    ClassificationWishListVsPantryInternal,
    DayPlan,
    DaySettings,
    Ingredient,
    InternalClassification,
    Item,
    ItemInfo,
    ItemInfoParsed,
    MealSlot,
    Offer,
    PantryAndWishes,
    PlannerSettings,
    QuantityInfo,
    AddRecipe,
    WeekPlan,
    WeekSettings,
)


logger_ = logging.getLogger(__name__)


def convert_timestamps_to_dates(
    timestamps_json: str | None, logger: logging.Logger | None = None
) -> list[str]:
    """
    Convert ISO timestamps to DD.MM.YYYY date strings for display.

    Takes a JSON string containing ISO format timestamps and converts them to
    human-readable date format (DD.MM.YYYY).

    Args:
        timestamps_json: JSON string containing ISO timestamps, or None

    Returns:
        List of date strings in DD.MM.YYYY format, or empty list if conversion fails
    """
    try:
        if not timestamps_json or timestamps_json == "null":
            return []
        timestamps = json.loads(timestamps_json or "[]")
        return [
            datetime.fromisoformat(ts).date().strftime("%d.%m.%Y") for ts in timestamps
        ]
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        if logger:
            logger.error(f"Failed to convert timestamps: {e}")
        return []


def sanitize_string(value: Optional[str], default: str = "") -> str:
    """
    Strip whitespace from string or return default value.

    Removes leading and trailing whitespace from the input string. If the input is
    None or empty, returns the provided default string.

    Args:
        value: String value to sanitize
        default: Default string to return if value is None or empty

    Returns:
        Sanitized string with whitespace removed
    """
    return (value or default).strip()


def sanitizeDeprecationDays(DeprecationDays: int | None, default: int = 30) -> int:
    """
    Sanitize and validate deprecation days parameter.

    Validates the deprecation days value, ensuring it's an integer within a reasonable
    range. Falls back to environment variable or default value if not provided or invalid.

    Args:
        DeprecationDays: Optional deprecation period in days
        default: Default value in days if sanitization fails

    Returns:
        Validated deprecation days as integer

    Note:
        Maximum set to 1000 days (2.7 years) for sanity checking
    """
    if DeprecationDays is None:
        raw_deprecation_days = os.getenv("DEPRECATION_DAYS_CATALOGUE", str(default))
        try:
            DeprecationDays = int(raw_deprecation_days)
        except ValueError:
            DeprecationDays = default

    return max(1, min(DeprecationDays, 1000))


def validate_wish_list(value: Optional[str]) -> bool:
    """
    Normalize wish list flag to boolean.

    Converts string values like "true", "false", empty strings, etc. into a proper
    boolean flag. Returns False for any falsy or non-true value.

    Args:
        value: String value to normalize as wish list flag

    Returns:
        True if value is "true" (case-insensitive), False otherwise

    Examples:
        "true" -> True
        "TRUE" -> True
        "false" -> False
        "" -> False
        None -> False
    """
    if not value:
        return False
    if value.strip().lower() == "true":
        return True
    return False


async def obtainSupermarketId(
    con: asyncpg.pool.PoolConnectionProxy,
    body: AddCatalogueRequest,
    maxDerivationCoord: float = 0.00001,
    logger: logging.Logger | None = None,
) -> int | dict[Literal["status", "detail"], str]:
    """
    Find the nearest supermarket ID based on geographic data or address.

    Searches the database for supermarkets matching either:
    - Coordinates with a small derivation tolerance (~11 meters)
    - Exact address match

    Requires valid body data (at least coordinates OR address+city/postcode).

    Args:
        con: Database connection pool
        body: Catalogue request body containing location data
        maxDerivationCoord: Maximum coordinate derivation to use for proximity search (in degrees)

    Returns:
        Supermarket ID as integer if found, or error dictionary with status "error"

    Error Conditions:
        - Insufficient geographic data provided
        - No supermarkets found near coordinates
        - No address match found

    Example:
        # Returns 123 (supermarket ID)
        await obtainSupermarketId(con, AddCatalogueRequest(longitude=10.0, latitude=50.0))
    """
    # 0,0001 * 111_000 = 11,1 => max derivation is 11,1 meters
    if isCatolgueBodyValid(body):
        coordsSet = body.longitude is not None and body.latitude is not None
        otherMarkerSet = body.address is not None and (
            body.city is not None or body.postcode is not None
        )
        supermarket_row: asyncpg.Record | None = None

        try:
            if coordsSet:
                maxLong = body.longitude + maxDerivationCoord  # type: ignore
                minLong = body.longitude - maxDerivationCoord  # type: ignore
                maxLat = body.latitude + maxDerivationCoord  # type: ignore
                minLat = body.latitude - maxDerivationCoord  # type: ignore

                rows = await con.fetch(
                    """select supermarket_id from supermarkets where longitude >= $1 and longitude <= $2
                                                and latitude >= $3 and latitude <= $4""",
                    minLong,
                    maxLong,
                    minLat,
                    maxLat,
                )
                supermarket_row = rows[0] if rows else None

                if supermarket_row is None:
                    return {
                        "status": "error",
                        "detail": "No supermarkets found near the provided coordinates",
                    }

            elif otherMarkerSet:
                rows = await con.fetch(
                    "select supermarket_id from supermarkets where address = $1",
                    body.address.strip(),  # type: ignore
                )  # type: ignore
                if not rows:
                    return {
                        "status": "error",
                        "detail": "No supermarket found matching the provided address",
                    }
                supermarket_row = rows[0]

            if supermarket_row is None:
                return {
                    "status": "error",
                    "detail": "Could not match to market, neither by coordinates nor by address",
                }

            supermarket_id_raw = supermarket_row.get("supermarket_id")
            if supermarket_id_raw is None:
                return {
                    "status": "error",
                    "detail": "Supermarket match did not contain a supermarket_id",
                }

            try:
                supermarket_id = int(supermarket_id_raw)
                return supermarket_id
            except (TypeError, ValueError):
                return {
                    "status": "error",
                    "detail": "Supermarket match did not contain a valid supermarket_id",
                }

        except Exception as e:
            if logger:
                logger.error(f"Failed to obtain supermarket ID: {e}")
            return {
                "status": "error",
                "detail": f"Failed to find supermarket: {str(e)}",
            }
    else:
        return {
            "status": "error",
            "detail": "The body doesn't have enough geographic information for market matching",
        }


async def getUserIds(con: asyncpg.pool.PoolConnectionProxy) -> list[int]:
    res = await con.fetch("select distinct(user_id) as uid from inventory")
    return [int(r["uid"]) for r in res]


async def getAllUserItems(
    con: asyncpg.pool.PoolConnectionProxy,
) -> dict[int, dict[Literal["wish", "pantry"], dict[str, str]]]:
    """
    Fetch all users' inventory in a single query and return normalized structure.

    Queries the database for all inventory items across all users and organizes them
    by whether they are wish list items or pantry items.

    Returns:
        Nested dictionary structure: {
            user_id: {
                'wish': {item_id: item_name, ...},
                'pantry': {item_id: item_name, ...}
            }
        }

    This structure is useful for batch processing and wish-pantry matching operations.

    Args:
        con: Database connection pool

    Example:
        {
            1: {
                'wish': {'item_123': 'Apples', 'item_456': 'Bananas'},
                'pantry': {'item_789': 'Milk'}
            },
            2: {
                'wish': {'item_abc': 'Bread'},
                'pantry': {}
            }
        }
    """
    res = await con.fetch(
        """select inv.user_id, inv.item_id, it.item_name, inv.is_wish 
           from inventory inv 
           join items it on it.item_id = inv.item_id"""
    )
    users: dict[int, dict[Literal["wish", "pantry"], dict[str, str]]] = {}

    try:
        for r in res:
            uid = int(r["user_id"])
            if uid not in users:
                users[uid] = {"wish": {}, "pantry": {}}

            item_id = r["item_id"]
            item_name = r["item_name"]

            if r["is_wish"]:
                users[uid]["wish"][item_id] = item_name
            else:
                users[uid]["pantry"][item_id] = item_name

    except Exception as e:
        logger_.error(f"Failed to fetch all user items: {e}")
        return {}

    return users


async def cleanupStaleWishMappings(
    con: asyncpg.pool.PoolConnectionProxy,
    user_id: Optional[int] = None,
    logger: logging.Logger | None = None,
) -> int:
    """
    Remove stale wish-to-pantry mappings that no longer exist in inventory.

    Deletes entries from wish_mapping where the referenced item no longer exists in the
    user's pantry inventory. When user_id is provided, only cleans for that user.
    Without user_id, performs global cleanup (used by background daemons).

    This prevents orphaned mappings from accumulating when pantry items are deleted.

    Args:
        con: Database connection pool
        user_id: Optional user ID for targeted cleanup, None for global
        logger: Optional logger instance for logging cleanup results

    Returns:
        Number of affected rows (always 0 in current implementation, but kept for API compatibility)

    Example:
        # Cleanup for specific user
        await cleanupStaleWishMappings(con, user_id=123)

        # Global cleanup by daemon
        await cleanupStaleWishMappings(con)
    """
    active_logger = logger or logger_

    try:
        if user_id is not None:
            result = await con.execute(
                """
                DELETE FROM wish_mapping
                WHERE item_id IN (
                    SELECT wm.item_id
                    FROM wish_mapping wm
                    WHERE NOT EXISTS (
                        SELECT 1 FROM inventory inv
                        WHERE inv.item_id = wm.item_id
                          AND inv.user_id = $1
                          AND (inv.is_wish IS NULL OR inv.is_wish = FALSE)
                    )
                )
                """,
                user_id,
            )
            if result != "DELETE 0":
                cleanup_msg = (
                    f"Cleaned up {result} stale wish_mapping entries for user {user_id}"
                )
                active_logger.info(cleanup_msg)
        else:
            result = await con.execute(
                """
                DELETE FROM wish_mapping
                WHERE item_id NOT IN (
                    SELECT DISTINCT inv.item_id
                    FROM inventory inv
                    WHERE inv.is_wish = FALSE OR inv.is_wish IS NULL
                )
                """
            )
            if result != "DELETE 0":
                cleanup_msg = f"Cleaned up global stale wish_mapping entries: {result}"
                active_logger.info(cleanup_msg)

    except Exception as e:
        active_logger.error(f"Failed to cleanup stale wish mappings: {e}")
        return 0

    return 0


async def getCurrentWishHashForUser(
    con: asyncpg.pool.PoolConnectionProxy,
    user_id: int,
) -> str:
    """
    Compute the current wish list hash for the specified user.

    Generates a hash representing the current state of the user's wish list.
    This hash is used by the daemon to track wish list changes over time and
    to filter out stale wish-to-pantry mappings that were created from previous
    versions of the wish list.

    The pantry list hash is NOT used for display filtering because the daemon
    overwrites it with each computation, making it unreliable for fetches.

    Args:
        con: Database connection pool
        user_id: User ID to compute hash for

    Returns:
        Base64-encoded hash string representing the wish list state

    See Also:
        - hashListState() for hash generation details
        - cleanupStaleWishMappings() for stale mapping cleanup functionality
        - craftWishItemLists() for batch wish.item matching
    """
    wish_dict = await getCurrentWishListUser(con, user_id)
    return hashListState(list(wish_dict.values()))


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


async def getCurrentPantryListUserPydantic(
    con: asyncpg.pool.PoolConnectionProxy, user_id: int
) -> list[Item]:
    res = await con.fetch(
        """SELECT inv.item_id AS item_id, it.item_name AS item_name, COUNT(inv.item_id) AS count,
            it.amount as amount, it.unit as unit
            FROM inventory inv
            JOIN items it ON it.item_id = inv.item_id
            WHERE inv.user_id = $1 AND inv.is_wish = false
            GROUP BY inv.item_id, it.item_name, it.amount, it.unit""",
        user_id,
    )
    return [
        Item(
            item_name=r["item_name"],
            item_id=r["item_id"],
            count=r["count"],
            quantity=QuantityInfo(
                product_quantity=r["amount"], product_quantity_unit=r["unit"]
            ),
        )
        for r in res
    ]


async def setUserReclassificationNeed(
    con, user_id: int, classificationKind: str = "wish_mapping"
):
    await con.execute(
        """
        INSERT INTO classification_need(user_id, classification_kind)
        VALUES($1, $2)
        ON CONFLICT (user_id)
        DO UPDATE SET classification_kind = EXCLUDED.classification_kind
        """,
        user_id,
        classificationKind,
    )


async def deleteReclassificationNeedBatch(
    con, userIds: list[int] | str, kind: str = "wish_mapping"
):
    if userIds == "*":
        await con.execute(
            "delete from classification_need where classification_kind = $1",
            kind,
        )
    elif isinstance(userIds, str):
        raise Exception(
            f"user ids can only be '*' or an int list and not this: {userIds}"
        )
    else:
        await con.execute(
            "delete from classification_need where user_id = ANY($1) and classification_kind = $2",
            userIds,
            kind,
        )


async def getUserIdsNeedReclassification(
    con, classificationKind: str = "wish_mapping"
) -> list[int]:
    classificationKind = classificationKind.strip()
    if classificationKind == "" or classificationKind == "*":
        rows = await con.fetch("select user_id from classification_need")
    else:
        rows = await con.fetch(
            "select user_id from classification_need where classification_kind = $1",
            classificationKind,
        )

    return [int(row["user_id"]) for row in rows]


async def getItemsParsedForIds(con, itemIds: list[str]) -> list[Item]:
    rows = await con.fetch(
        """select items.item_id, item_name, inv.is_wish as is_wish from items 
                           join inventory inv on inv.item_id = items.item_id where items.item_id in $1""",
        tuple(itemIds),
    )
    res = []
    for row in rows:
        res.append(
            Item(
                item_id=row["item_id"],
                item_name=row["item_name"],
                count=1,
                quantity=QuantityInfo(
                    product_quantity=None, product_quantity_unit=None
                ),
            )
        )
    return res


async def getAllItems(
    con, userIds: list[int], wishList: bool = True
) -> dict[int, list[str]]:
    rows = await con.fetch(
        "select user_id, item_id from inventory where user_id = ANY($1) and is_wish = $2",
        userIds,
        wishList,
    )

    userToItems = {}
    for row in rows:
        uid = int(row["user_id"])
        userToItems.setdefault(uid, []).append(row["item_id"])

    return userToItems


async def getAllWishMappings(con, wishIds: list[str]) -> dict[str, str]:
    """return the (pantry) items mapped to the given list of wished items"""
    rows = await con.fetch(
        "select item_id, wish_item_id from wish_mapping where wish_item_id = Any($1)",
        wishIds,
    )
    return {row["item_id"]: row["wish_item_id"] for row in rows}


async def computeClassificationNeed(
    userToPantry: dict[int, list[str]],
    userToWishes: dict[int, list[str]],
    pantryWishMap: dict[str, str],
) -> dict[int, PantryAndWishes]:

    res: dict[int, PantryAndWishes] = {}

    for user in userToPantry.keys():
        pantry = userToPantry.get(user, [])
        wishes = userToWishes.get(user, [])
        # set default
        res[user] = PantryAndWishes(pantry=[], wishList=wishes)

        for p in pantry:
            mappedWishes = pantryWishMap.get(p, [])
            # check if pantry item is at least mapped to one
            # wish in our wish list
            if not set(mappedWishes).isdisjoint(wishes):
                # at least one is mapped -> no need to reclassify
                pass
            else:
                # need to classify
                res[user].pantry.append(p)

    return res


async def mapItemIdToName(con, itemIds: list[str]) -> dict[str, str]:
    rows = await con.fetch(
        "select item_id, item_name from items where item_id = ANY($1)", itemIds
    )
    return {row["item_id"]: row["item_name"] for row in rows}


async def buildWishPantryLists(
    con,
) -> tuple[dict[int, PantryAndWishes], dict[str, str]]:

    userIds: list[int] = await getUserIdsNeedReclassification(con, "wish_mapping")
    userToWishes: dict[int, list[str]] = await getAllItems(con, userIds, wishList=True)
    userToPantry: dict[int, list[str]] = await getAllItems(con, userIds, wishList=False)

    wishIds = list(chain.from_iterable(userToWishes.values()))
    pantryIds = list(chain.from_iterable(userToPantry.values()))
    allIds = [*wishIds, *pantryIds]

    pantryWishMap = await getAllWishMappings(con, wishIds)

    userToPantryAndWishes: dict[int, PantryAndWishes] = await computeClassificationNeed(
        userToPantry, userToWishes, pantryWishMap
    )
    itemIdToName: dict[str, str] = await mapItemIdToName(con, allIds)

    return userToPantryAndWishes, itemIdToName

async def addOffersBatch(
    con: asyncpg.pool.PoolConnectionProxy,
    offers: list[Offer],
    supermarketId: int,
    logger: logging.Logger,
):
    try:
        offerTuples: list[tuple] = []
        currentTime: datetime = datetime.now(timezone.utc)
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
            insert into grocery_offers(item_name, original_price, offer_price, supermarket_id, is_app_offer, added_at, weight_g, volume_ml, shortend_name)
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
) -> None:
    """
    Classify supermarket catalogue images and extract product offers.

    Processes uploaded catalogue files (PDFs or images) to extract grocery offers,
    classifying products and creating database entries for subsequent matching.

    The classification happens in the background:
    1. Validate the upload has sufficient geographic/location data
    2. Use the CatalogueClassifier to extract offer information
    3. Match to nearest supermarket using body's coordinates/address
    4. Store offers in database asynchronously

    Args:
        pool: Database connection pool
        classifier: CatalogueClassifier instance for processing the file
        body: AddCatalogueRequest containing location and supermarket metadata
        filepath: Path to the uploaded catalogue file
        logger: Logger instance for error/failure reporting

    Note:
        - This function runs asynchronously via asyncio.create_task() in server.py
        - Returns None but logs errors via the provided logger
        - File validation (PDF/image format, etc.) happens in server.py

    Example:
        await classifyCatalogue(
            pool,
            catalogue_classifier,
            AddCatalogueRequest(longitude=10.0, latitude=50.0, name="Shop"),
            "/uploads/catalogue.pdf",
            logger
        )
    """
    try:
        if isCatolgueBodyValid(body) and filepath.strip() != "":
            logger.info(f"Starting catalogue classification: {filepath}")
            response = classifier.classify_catalogue(filepath)

            async with pool.acquire() as con:
                supermarketId: int | dict = await obtainSupermarketId(con, body)

                if isinstance(supermarketId, dict):
                    error_msg = (
                        f"Couldn't classify catalogue with filepath: {filepath}, "
                        f"cause there wasn't enough info for market matching: {supermarketId}"
                    )
                    logger.error(error_msg)
                    raise ValueError(error_msg)

                elif isinstance(supermarketId, int):
                    await addOffersBatch(
                        con, response.offers, supermarketId, logger=logger
                    )
                    logger.info(
                        f"Successfully classified {len(response.offers)} offers for supermarket {supermarketId}"
                    )

        else:
            error_msg = (
                "Body doesn't have enough geographic information for market matching"
            )
            logger.error(error_msg)
            raise ValueError(error_msg)

    except Exception as e:
        logger.error(f"Classify catalog failed for {filepath}: {e}")
        import traceback

        logger.error(traceback.format_exc())


def reformatTimeStamp(ts: Any | list[Any], fmt: str = "%d.%m.%Y") -> str:
    """
    Convert timestamp(s) to readable date string in specified format.

    Flexible timestamp reformatter that handles various input types:
    - Single datetime object
    - List of timestamps (uses first element)
    - ISO timestamp string
    - Any parsable timestamp value

    Args:
        ts: Timestamp value to format (datetime, list, string, epoch, etc.)
        fmt: Format string for output (default: DD.MM.YYYY)

    Returns:
        Formatted date string

    Examples:
        >>> reformatTimeStamp("2024-01-15T10:30:00")
        "15.01.2024"
        >>> reformatTimeStamp(["2024-01-15", "2024-02-20"])
        "15.01.2024"
    """
    try:
        if isinstance(ts, list):
            ts = ts[0]
        if isinstance(ts, dt.datetime):
            return ts.strftime(fmt)
        return parser.parse(str(ts)).strftime(fmt)
    except Exception as e:
        logger_.error(f"Failed to reformat timestamp {ts}: {e}")
        return "Invalid date"


def convertToBerlinTime(
    currentDatetime: dt.datetime | None, tz: ZoneInfo = ZoneInfo("Europe/Berlin")
) -> dt.datetime:
    if currentDatetime is None:
        return dt.datetime.now(timezone.utc)
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


async def addMealSlotsForUser(
    con: asyncpg.pool.PoolConnectionProxy, uid: int, slots: list[MealSlot]
):
    updates = []
    for meal in slots:
        updates.append(
            (
                uid,
                meal.recipe_id,
                meal.meal_type,
                meal.servings,
                meal.day,
                meal.day_time,
            )
        )
    await con.executemany(
        """ insert into meal_slots (user_id, recipe_id, meal_type,
                              servings, day, day_time) values ($1, $2, $3, $4, $5, $6)""",
        updates,
    )


async def purgeCurrentWeekPlanForUser(
    con: asyncpg.pool.PoolConnectionProxy, uid: int
) -> None:
    await con.execute("delete from meal_slots where user_id = $1", uid)


async def replaceWeekPlanForUser(
    con: asyncpg.pool.PoolConnectionProxy, weekPlan: WeekPlan, uid: int
) -> dict:
    await purgeCurrentWeekPlanForUser(con, uid)
    plan: dict = weekPlan.model_dump()
    meals: list[MealSlot] = []
    for day in plan.keys():
        dayDict: dict = plan.get(day, {})
        mealDicts: list[dict] = list(dayDict.values())
        mealObjs: list[MealSlot] = [MealSlot(**m) for m in mealDicts]
        meals.extend(mealObjs)
    await addMealSlotsForUser(con, uid, meals)

    return {}


async def purgeCurrentWeekSettingsForUser(
    con: asyncpg.pool.PoolConnectionProxy, uid: int
) -> None:
    await con.execute("delete from day_settings where user_id = $1", uid)


async def addDaySettingsForUser(
    con: asyncpg.pool.PoolConnectionProxy, uid: int, days: list[DaySettings]
):
    updates = []
    for day in days:
        updates.append(
            (
                uid,
                day.day,
                day.day_meal_time_type,
                day.breakfast_blocked,
                day.lunch_blocked,
                day.dinner_blocked,
            )
        )
    await con.executemany(
        """ insert into day_settings (user_id, day, day_meal_time_type,
                              breakfast_blocked, lunch_blocked, dinner_blocked) values ($1, $2, $3, $4, $5, $6)""",
        updates,
    )


async def deleteMealInWeek(
    con: asyncpg.pool.PoolConnectionProxy, uid: int, meal: MealSlot
):
    await con.execute(
        "delete from meal_slots where user_id = $1 and day = $2 and day_time = $3",
        uid,
        meal.day,
        meal.day_time,
    )


async def deletePlannerSettings(con: asyncpg.pool.PoolConnectionProxy, uid: int):
    await con.execute("delete from planner_settings where user_id = $1", uid)


async def replacePlannerSettings(
    con: asyncpg.pool.PoolConnectionProxy, uid: int, planner: PlannerSettings
):
    await deletePlannerSettings(con, uid)
    await con.execute(
        """insert into planner_settings (user_id, 
                      fast_day_meal_minutes, normal_day_meal_minutes, default_servings)
                      values ($1, $2, $3, $4)""",
        uid,
        planner.quickMealMinutes,
        planner.normalMealMinutes,
        planner.defaultServings,
    )


async def getPlannerSettings(
    con: asyncpg.pool.PoolConnectionProxy, uid: int
) -> PlannerSettings:
    row = await con.fetchrow(
        """select COALESCE(fast_day_meal_minutes, 15) as quickMealMinutes,
                             COALESCE(normal_day_meal_minutes, 45) as normalMealMinutes,
                             COALESCE(default_servings, 2) as defaultServings
                             from planner_settings where user_id = $1""",
        uid,
    )
    if row is None:
        return PlannerSettings(
            defaultServings=2, quickMealMinutes=15, normalMealMinutes=45
        )
    return PlannerSettings(**row)


async def getSpecificMealInWeek(
    con: asyncpg.pool.PoolConnectionProxy, day: str, day_type: str, uid: int
) -> MealSlot:
    row = await con.fetchrow("select recipe_id, meal_type, servings, day, day_time")
    return MealSlot(
        recipe_id=row.get("recipe_id"),
        servings=row.get("servings"),
        meal_type=row.get("meal_type"),
        day=row.get("day"),
        day_time=row.get("day_time"),
    )


async def deleteRecipeById(con: asyncpg.pool.PoolConnectionProxy, recipeId: int):

    # delete linked junction table entries
    await con.execute("delete from meal_slots where recipe_id = $1", recipeId)
    await con.execute(
        "delete from recipe_ingredient_map where recipe_id = $1", recipeId
    )

    # delete recipe itself
    await con.execute("delete from recipes where recipe_id = $1", recipeId)


async def replaceMealByTimestamp(
    con: asyncpg.pool.PoolConnectionProxy, uid: int, meal: MealSlot
):
    await con.execute(
        "delete from meal_slots where user_id = $1 and day = $2 and day_time = $3",
        uid,
        meal.day,
        meal.day_time,
    )  # delete current entry

    await con.execute(
        """insert into meal_slots (recipe_id, meal_type, servings,
                      user_id, day, day_time) values ($1, $2, $3, $4, $5, $6)""",
        (meal.recipe_id, meal.meal_type, meal.servings, uid, meal.day, meal.day_time),
    )


async def replaceWeekSettingsForUser(
    con: asyncpg.pool.PoolConnectionProxy, weekSettings: WeekSettings, uid: int
) -> dict:

    await purgeCurrentWeekSettingsForUser(con, uid)
    settingsDict: dict = weekSettings.model_dump()
    daySettDicts: list[dict] = []
    for day in settingsDict.keys():
        settingsDay: dict = settingsDict.get(day, {})
        daySettDicts.append(settingsDay)

    parsedSettings: list[DaySettings] = [DaySettings(**d) for d in daySettDicts]
    await addDaySettingsForUser(con, uid, parsedSettings)
    return {}


async def getWeekSettingsForUser(
    con: asyncpg.pool.PoolConnectionProxy, uid: int
) -> WeekSettings:
    res = await con.fetch(
        """select day, day_meal_time_type, breakfast_blocked,
                          lunch_blocked, dinner_blocked from day_settings where user_id = $1""",
        uid,
    )
    dayToSettings: dict[str, DaySettings] = {}
    for row in res:
        dayToSettings[row.get("day")] = DaySettings(**dict(row))

    return WeekSettings(**dayToSettings)


async def getWeekPlanForUser(
    con: asyncpg.pool.PoolConnectionProxy, uid: int
) -> WeekPlan:
    res = await con.fetch(
        """select recipe_id, meal_type, servings,
                          day, day_time from meal_slots where user_id = $1""",
        uid,
    )

    slots: list[MealSlot] = []
    for row in res:
        slots.append(MealSlot(**dict(row)))

    dayToSlots: dict[str, dict] = {}
    for meal in slots:
        dayToSlots.setdefault(meal.day, {})[meal.day_time] = meal

    dayPlans: dict[str, DayPlan] = {}
    for day in dayToSlots.keys():
        dayMeals = dayToSlots.get(day, {})
        breakfast = dayMeals.get("breakfast")
        lunch = dayMeals.get("lunch")
        dinner = dayMeals.get("dinner")

        dayPlans[day] = DayPlan(breakfast=breakfast, lunch=lunch, dinner=dinner)

    return WeekPlan(**dayPlans)


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
        return base64.urlsafe_b64encode(h.digest()).decode()  # urlsafe: no + or /
    return h.hexdigest()


async def insertIngredientsAndMap(con, recipe_id: int, ingredients: list[Ingredient]):
    try:
        print(f"updating for these ingredients: {ingredients}")
        records = [
            (
                ing.name,
                int(float(ing.amount)) if ing.amount else -1,
                ing.unit or "none",
                ing.count,
            )
            for ing in ingredients
        ]

        rows = await con.fetch(
            """
            INSERT INTO ingredients (name, amount, unit)
            SELECT x.name, x.amount, x.unit
            FROM UNNEST($1::text[], $2::int[], $3::text[]) 
            AS x(name, amount, unit)
            ON CONFLICT (name, amount, unit)
            DO UPDATE SET name = EXCLUDED.name
            RETURNING ingredient_id, name, amount, unit
            """,
            [r[0] for r in records],
            [r[1] for r in records],
            [r[2] for r in records],
        )

        id_map = {(r["name"], r["amount"], r["unit"]): r["ingredient_id"] for r in rows}

        await con.executemany(
            """
            INSERT INTO recipe_ingredient_map (recipe_id, ingredient_id, count)
            VALUES ($1, $2, $3)
            ON CONFLICT(recipe_id, ingredient_id) DO NOTHING
            """,
            [
                (
                    recipe_id,
                    id_map[(r[0], r[1], r[2])],
                    r[3],
                )
                for r in records
            ],
        )

    except Exception as e:
        print(f"Batch insert failed: {e}")
        raise


async def deleteIngredientsById(con: asyncpg.pool.PoolConnectionProxy, recipeId: int):
    await con.execute(
        "delete from ingredients recipe_ingredient_map where recipe_id = $1", recipeId
    )


async def modifyRecipe(
    con: asyncpg.pool.PoolConnectionProxy,
    userId: int,
    recipeId: int,
    recipe: AddRecipe,
) -> dict:
    async with con.transaction():
        print("modyfing recipe")
        userOwnsRecipe = await con.fetchval(
            "select exists (select recipe_id from recipes where user_id = $1 and recipe_id = $2)",
            userId,
            recipeId,
        )

        if userOwnsRecipe is True:
            print("user owns recipe")
            await con.fetchval(
                """
                update recipes
                set name = $1,
                    base_time = $2,
                    default_portions = $3,
                    tags = $4,
                    steps = $5,
                    emoji = $6
                where recipe_id = $7
                """,
                recipe.name,
                recipe.baseTime,
                recipe.baseServings,
                recipe.tags,
                recipe.steps,
                recipe.emoji,
                recipeId,
            )

            await deleteIngredientsById(con, recipeId)
            await insertIngredientsAndMap(con, recipeId, recipe.ingredients)
            return {"state": "success"}
        else:
            return {"state": "error", "detail": "the user doesnt own this recipe"}


async def insertRecipe(
    con: asyncpg.pool.PoolConnectionProxy,
    userId: int,
    recipe: AddRecipe,
) -> int:
    async with con.transaction():
        recipe_id = await con.fetchval(
            """
            INSERT INTO recipes (user_id, name, base_time, default_portions, tags, steps, emoji)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING recipe_id
            """,
            userId,
            recipe.name,
            recipe.baseTime,
            recipe.baseServings,
            recipe.tags,
            recipe.steps,
            recipe.emoji,
        )

        await insertIngredientsAndMap(con, recipe_id, recipe.ingredients)

        return recipe_id


async def addRecipeToDb(
    con: asyncpg.pool.PoolConnectionProxy, userId: int, recipe: AddRecipe
) -> dict:
    try:
        recipe_id = await insertRecipe(con, userId, recipe)

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
    con: asyncpg.pool.PoolConnectionProxy, username: str | None
) -> int:
    if username is None:
        raise ValueError("you gotta provide a valid username and not None")

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

    awareDate = date if date.tzinfo is not None else convertToBerlinTime(date)
    utcDate = awareDate.astimezone(dt.timezone.utc).replace(tzinfo=None)

    item_id = generateManualItemId(item_name)

    onlyAddingToExisting = await userHasItemInPantry(
        con, userId, item_id
    )  # checks if user has it in current pantry)
    if not onlyAddingToExisting:
        await setUserReclassificationNeed(con, userId, "wish_mapping")
    try:
        if not quantity or quantity.product_quantity == -1:
            return {
                "state": "error",
                "operation": "add",
                "mode": "manual adding",
                "error": "there was no quantity data supplied for the given item",
                "suggestion": "ask the user for manual quantity entry data",
                "quantity_needed": True,
            }

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
            utcDate,
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


async def userHasItemInPantry(con, userId: int, itemId: str) -> bool:
    return await con.fetchval(
        "select exists ( select item_id from inventory where user_id = $1 and item_id = $2)",
        userId,
        itemId,
    )


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
) -> dict[str, Any]:
    """
    Add an item to user's inventory with validation and data enrichment.

    Handles item addition through multiple pathways:
    1. EAN lookup via OpenFoodFacts API for product details
    2. Manual entry with item name for items without EAN codes
    3. Quantity parsing and normalization
    4. Support for both adding and removing items (count >= 1 or <= -1)
    5. Creation of manual items with classification tracking

    The function performs:
    - User validation
    - Item existence checking
    - API calls to enrich item data (when using EAN)
    - Quantity normalization and parsing
    - Inventory updating or removal
    - Wish list vs. pantry tracking

    Args:
        http_client: HTTP client for API calls
        pool: Database connection pool
        username: Current user's username
        ean: EAN barcode string (optional if item_name provided)
        item_name: Item name for manual entry (optional if ean provided)
        count: Number to add (>1) or remove (<-1); 0 returns info
        is_wish: True to add to wish list, False for pantry
        quantity: Quantity information for manual items
        logger: Logger for debugging and error reporting
        date: Date/time for inventory entry (defaults to now)

    Returns:
        Dictionary with operation result status, operation type, and details

    Result structure examples:
        Success add: {"state": "success", "operation": "add", "mode": "ean", "ean": "123456"}
        Success delete: {"state": "success", "operation": "delete", "mode": "manual adding"}
        Error: {"state": "error", "operation": "add", "error": "Message", "suggestion": "Hint"}

    Exceptions:
        ValueError: If username is None
        Exception: Various error conditions during processing
    """
    try:
        if not username:
            raise ValueError("Username should not be None for this function call")

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

        dateNormalized = dt.datetime.now()

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
                        onlyAddingToExisting = await userHasItemInPantry(
                            con, userId, ean
                        )  # checks if user has it in current pantry)
                        if not onlyAddingToExisting:
                            await setUserReclassificationNeed(
                                con, userId, "wish_mapping"
                            )

                        itemKnown = await itemIsKnown(
                            con, ean
                        )  # checks if it is was ever added by anyone
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
        if not data.get("status_verbose") == "product found":
            logger.error(f"couldnt resolve item name for ean {ean}")
            return None

        product_dict = data.get("product", {})
        if not product_dict or not product_dict.get("product_name"):
            logger.error(
                f"couldnt resolve item name for ean {ean} (missing product data)"
            )
            return None

        parsed = ItemInfo.model_validate(product_dict)
        return parsed
    except Exception as e:
        raise Exception(f"failed with this error: {e}")


async def getImageUrlAsync(
    client: httpx.AsyncClient,
    ean: str,
    logger: logging.Logger | None = None,
    delay: float = 0.5,
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
        if logger:
            logger.error(f"Failed to fetch image for ean {ean}: {e}")
        return "https://boldo.ddns.net/none_available.webp"
    return ""


def mapWishToNeed(
    wish: Item, wishRes: ClassificationWishListVsPantryInternal
) -> QuantityInfo:
    if wish.quantity.product_quantity is None:
        raise Exception(
            f"the wish item cant have quantity None: {wish.model_dump_json()}"
        )

    quantityNeeded = wish.quantity.product_quantity
    for mapping in wishRes.mappings:
        mappedWishItem = mapping.mappedWishItem
        if mappedWishItem and mappedWishItem.item_name:
            quantObj = mappedWishItem.quantity
            if (
                quantObj.product_quantity
                and quantObj.product_quantity_unit
                == wish.quantity.product_quantity_unit
            ):
                quantityNeeded -= quantObj.product_quantity

    return QuantityInfo(
        product_quantity=quantityNeeded,
        product_quantity_unit=wish.quantity.product_quantity_unit,
    )


async def addWishesToDb(
    pool: asyncpg.Pool,
    uid: int,
    wishes: dict[str, tuple[str, QuantityInfo]],  # item_id -> (item_name, qty)
    wishRes: ClassificationWishListVsPantryInternal,
    logger: logging.Logger | None = None,
) -> None:
    """Add wishes to database from a dictionary of items with quantity info."""
    if logger is None:
        logger = logger_

    async with pool.acquire() as con:
        for _, (item_name, quant_needed) in wishes.items():
            if (
                quant_needed
                and quant_needed.product_quantity
                and quant_needed.product_quantity > 0
            ):
                await handleManualItems(
                    con,
                    item_name,
                    1,
                    uid,
                    True,
                    quantity=quant_needed,
                    date=datetime.now(timezone.utc),
                    logger=logger,
                )
        await mapWishesToItemDb(con, wishRes)


def isValidManualId(id: str | None) -> bool:
    if id is None:
        return False
    s = re.search("manual-[0-9]*", id)
    return s is not None


def isValidItemId(id: str | None) -> bool:
    if id is None:
        return False
    s = re.fullmatch(r"\d+", id)
    return s is not None


def calcQuantNeed(wish: InternalClassification) -> int:
    if wish and wish.mappedWishItem and wish.pantryItem:
        return (wish.mappedWishItem.quantity.product_quantity or 0) - (
            wish.pantryItem.quantity.product_quantity or 0
        )
    else:
        return 0


async def mapWishesToItemDb(
    con: asyncpg.pool.PoolConnectionProxy,
    wishRes: ClassificationWishListVsPantryInternal,
):
    print(f"now running mapWishesToItemDb wish {len(wishRes.mappings)} mappings ")
    updatesMap: list[tuple[int, str, int]] = []
    updatesIngTable: list[tuple[int, int, str, str]] = []
    for wish in wishRes.mappings:
        wishItem = wish.mappedWishItem
        pantryItem = wish.pantryItem
        if wishItem and pantryItem:
            if isValidItemId(wishItem.item_id):
                updatesMap.append(
                    (int(wishItem.item_id), pantryItem.item_id, calcQuantNeed(wish))
                )
                updatesIngTable.append(
                    (
                        int(wishItem.item_id),
                        int(wishItem.quantity.product_quantity)
                        if wishItem.quantity.product_quantity is not None
                        else -1,
                        wishItem.quantity.product_quantity_unit or "none",
                        wishItem.item_name,
                    )
                )

    await con.executemany(
        """
        INSERT INTO ingredients (ingredient_id, amount, unit, name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (ingredient_id) DO NOTHING
        """,
        updatesIngTable,
    )

    await con.executemany(
        """
            insert into ingredient_item_map(ingredient_id, item_id, missing_quantity)
            values ($1, $2, $3)
            ON CONFLICT (ingredient_id, item_id) DO NOTHING
        """,
        updatesMap,
    )


async def addNonClassifiedWishes(
    pool: asyncpg.Pool,
    uid: int,
    wishRes: ClassificationWishListVsPantryInternal,
    TotalWishes: list[Item],
) -> None:
    wishToNeed: dict[str, tuple[str, QuantityInfo]] = {}
    for wish in TotalWishes:
        wishToNeed[wish.item_id] = (wish.item_name, mapWishToNeed(wish, wishRes))

    await addWishesToDb(pool, uid, wishToNeed, wishRes)
