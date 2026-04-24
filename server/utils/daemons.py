import asyncio
import logging
import traceback

import asyncpg
import httpx

from Config import Config
from utils.api_helpers import buildWishPantryLists, getImageUrlAsync


async def rescanImageUrls(
    pool: asyncpg.Pool,
    delay: float = 1,
    logger: logging.Logger | None = None,
):
    try:
        helper_logger = logger or logging.getLogger(__name__)
        updated_count = 0
        async with httpx.AsyncClient(
            headers={"User-Agent": "grocery-list-app/1.0"},
            timeout=httpx.Timeout(5.0),
        ) as client:
            async with pool.acquire() as con:
                eansToMod = await resetDeprecatedImageUrls(con, deprecationDays=30)
                if not eansToMod:
                    if logger:
                        logger.info("rescanImageUrls: nothing to update")
                    return {"done": True, "updated": 0, "total_empty": 0}

                for ean in eansToMod:
                    image_url = await getImageUrlAsync(
                        client,
                        ean,
                        delay=delay,
                        logger=helper_logger,
                    )
                    if image_url:
                        await con.execute(
                            "update items set image_url = $1 where item_id = $2",
                            image_url,
                            ean,
                        )
                        updated_count += 1

        if logger:
            logger.info(
                f"Updated {updated_count} image URLs out of {len(eansToMod)} entries"
            )
        return {"done": True, "updated": updated_count, "total_empty": len(eansToMod)}

    except Exception as e:
        if logger:
            logger.error(f"Failed while rescanning image URLs: {e}")
            logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}


async def resetDeprecatedImageUrls(
    con: asyncpg.pool.PoolConnectionProxy, deprecationDays: int = 30
) -> list[str]:

    items_to_update = await con.fetch(
        """
        select item_id as ean from items
        where (last_checked_at < now() - $1 * interval '1 day' or image_url is null)
        and not item_id = '-1'
        """,
        deprecationDays,
    )

    await con.execute(
        """
        update items set last_checked_at = now()
        where (last_checked_at < now() - $1 * interval '1 day' or image_url is null)
        and not item_id = '-1'
        """,
        deprecationDays,
    )

    return [item["ean"] for item in items_to_update]


async def _fetch_categories(client: httpx.AsyncClient, ean: str) -> list:
    res = await client.get(
        f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=categories_tags",
        timeout=5.0,
    )
    data = res.json()
    return data.get("product", {}).get("categories_tags", [])


async def mapItemToWishDaemon(pool: asyncpg.Pool, logger: logging.Logger | None = None):
    try:
        from transcript_classify import classifier 

        async with pool.acquire() as con:
            (
                item_names,
                wished_lists,
                itemIdMapping,
                hashPerItem,
            ) = await buildWishPantryLists(
                con, sinkLabel=Config.SINK_LABEL_WISH_MAPPING
            )

        if not item_names or not wished_lists:
            if logger:
                logger.info("mapItemToWishDaemon: nothing to map")
            return

        mapped_results: dict[str, dict] = await asyncio.to_thread(
            classifier.mapWishItemBatch,
            item_names,
            wished_lists,
        )

        updates = []
        items = mapped_results["items"]
        wishListToIdx: dict[str, int] = mapped_results["wish_list_to_idx"]
        idxToWishList: dict[int, str] = {v: k for k, v in wishListToIdx.items()}

        if logger:
            logger.warning(
                f"item id mapping: {itemIdMapping},\nitems: {items}\nidx to wish list: {idxToWishList}"
            )
        for idx, item_name in enumerate(items.keys()):
            mappedItemDict: dict = items[item_name]
            mapped_wish = mappedItemDict["mapped_wish"]
            wish_hash, pantry_hash = hashPerItem[idx]
            updates.append(
                (
                    itemIdMapping[item_name],
                    itemIdMapping[mapped_wish],
                    wish_hash,
                    pantry_hash,
                )
            )
        if logger:
            logger.info(f"these are the updates: {updates}")

        if not updates:
            if logger:
                logger.info("mapItemToWishDaemon: no wish matches produced")
            return

        async with pool.acquire() as con:
            await con.executemany(
                """
                    INSERT INTO wish_mapping (item_id, wish_item_id, wish_list_hash, pantry_list_hash)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (item_id, wish_list_hash)
                    DO UPDATE SET wish_item_id = EXCLUDED.wish_item_id
                """,
                updates,
            )
        if logger:
            logger.info(
                "Updated %d item mappings out of %d candidate items using %d wished items",
                len(updates),
                len(item_names),
                len(wished_lists),
            )

    except Exception as e:
        if logger:
            logger.error(f"Daemon for item wish mapping failed: {e}")
            logger.error(traceback.format_exc())


async def rescanImageUrlsDaemon(
    pool: asyncpg.Pool, logger: logging.Logger | None = None, waitingTime: float = 10.0
):
    try:
        while True:
            await asyncio.sleep(waitingTime)
            if logger:
                logger.info("rescanning for empty and deprecated image urls")
            await rescanImageUrls(pool, logger=logger)
    except Exception as error:
        if logger:
            logger.error(
                f"the rescanImageUrlsDaemon daemon failed with this error: {error} "
            )


async def classificationDaemon(
    pool: asyncpg.Pool, logger: logging.Logger | None = None, waitingTime: float = 10.0
):
    while True:
        try:
            if logger:
                logger.info("classificationDaemon: starting pass")

            await rescanCategoriesProcess(pool, logger=logger)
            await shortenItemNamesDaemon(pool, logger=logger)
            await assignTagsTask(pool, logger=logger)
            await mapItemToWishDaemon(pool, logger=logger)

            if logger:
                logger.info("classificationDaemon: pass complete")

        except asyncio.CancelledError:
            raise
        except Exception as e:
            if logger:
                logger.error(f"classificationDaemon failed: {e}")
                logger.error(traceback.format_exc())

        await asyncio.sleep(waitingTime)


async def shortenItemNamesDaemon(
    pool: asyncpg.Pool, logger: logging.Logger | None = None
):
    try:
        from transcript_classify import classifier
 
        # Fetch phase: acquire, query, release immediately
        async with pool.acquire() as con:
            rows = await con.fetch(
                """
                select distinct(items.item_name) as item_name,
                classification.categories_off as categories
                from items 
                left join item_classification classification on
                classification.item_id = items.item_id
                where items.shortend_name is null
                """
            )

        original_names = [
            row["item_name"]
            for row in rows
            if row["item_name"] and row["item_name"].lower() not in ("", "none")
        ]
        categories = [row["categories"] for row in rows]

        updated_count = 0
        if not original_names:
            return

        shortend_dict = classifier.shortenTextBatch(original_names, categories)

        updates = [
            (shortend_dict.get(item_name), item_name)
            for item_name in shortend_dict.keys()
            if shortend_dict.get(item_name, None)
        ]
        if logger:
            logger.warning("=" * 60)
            logger.info(f"this is the shortend_dict: {shortend_dict}")
            logger.warning(f"these are the updates: {updates}")
        if updates:
            async with pool.acquire() as con:
                await con.executemany(
                    "UPDATE items SET shortend_name = $1 WHERE item_name = $2",
                    updates,
                )
            updated_count = len(updates)

        if logger:
            logger.info(
                f"Updated {updated_count} item names out of {len(original_names)} empty entries"
            )

    except asyncio.CancelledError:
        raise
    except Exception as e:
        if logger:
            logger.error(f"Daemon for item name shortening failed: {e}")
            logger.error(traceback.format_exc())


async def assignTagsTask(pool: asyncpg.Pool, logger: logging.Logger | None = None):

    try:
        from transcript_classify import classifier

        async with pool.acquire() as con:
            rows = await con.fetch(
                """
                select inv.item_id as ean, items.item_name, classification.class as class,
                classification.categories_off as categories
                from inventory inv join items on items.item_id = inv.item_id
                join item_classification classification on classification.item_id = inv.item_id
                where classification.class is null
                """
            )

        if not rows:
            return

        itemsToProcess = [
            {
                "item_name": row["item_name"],
                "shortend_name": row["class"],
                "categories": row["categories"],
            }
            for row in rows
            if row["ean"] not in ("-1", "0", "1")
        ]

        if not itemsToProcess:
            return

        tagMapping: dict[str, dict[str, str]] = await classifier.tagAssignmentBatch(
            items=itemsToProcess
        )

        updates = []
        for item in itemsToProcess:
            try:
                itemName = item["item_name"]
                tagsDict = tagMapping[itemName]
                tags: str = tagsDict["base"]
                updates.append((str(tags), str(itemName)))
            except Exception as e:
                if logger:
                    logger.error(
                        f"tag assignment failed for item {item.get('item_name')}: {tagsDict} — {e}"
                    )
        if updates:
            async with pool.acquire() as con:
                await con.executemany(
                    """
                    UPDATE item_classification
                    SET class = $1
                    FROM items
                    WHERE items.item_name = $2
                    AND item_classification.item_id = items.item_id
                    """,
                    updates,
                )

    except asyncio.CancelledError:
        raise
    except Exception as e:
        if logger:
            logger.error(f"Daemon for tag assignment failed: {e}")
            logger.error(traceback.format_exc())


async def rescanCategoriesProcess(
    pool: asyncpg.Pool, logger: logging.Logger | None = None
):
    try:
        async with pool.acquire() as con:
            rows = await con.fetch("""
                SELECT DISTINCT(inv.item_id) AS ean, classification.categories_off AS categories
                FROM inventory inv
                LEFT JOIN item_classification classification ON classification.item_id = inv.item_id
                WHERE classification.categories_off IS NULL
                AND inv.item_id NOT IN ('-1', '0', '1')
            """)

        eansToMod = [row["ean"] for row in rows]

        if not eansToMod:
            if logger:
                logger.info("rescanCategoriesProcess: nothing to update")
            return {"done": True, "updated": 0, "total_empty": 0}

        results: dict[str, list] = {}
        async with httpx.AsyncClient(
            headers={"User-Agent": "grocery-list-app/1.0"},
            timeout=httpx.Timeout(10.0),
        ) as client:
            for ean in eansToMod:
                try:
                    categories = await _fetch_categories(client, ean)
                    results[ean] = categories
                except Exception as e:
                    if logger:
                        logger.warning(f"failed to get categories for ean {ean}: {e}")
                    results[ean] = []
                await asyncio.sleep(0.5)

        if not results:
            return {"done": True, "updated": 0, "total_empty": len(eansToMod)}

        updates = [
            (str(categories) if categories else "[]", ean)
            for ean, categories in results.items()
        ]
        if updates:
            async with pool.acquire() as con:
                await con.executemany(
                    "UPDATE item_classification SET categories_off = $1 WHERE item_id = $2",
                    updates,
                )
        updated_count = sum(1 for _, cats in results.items() if cats)

        if logger:
            logger.info(
                f"Updated {updated_count} category entries out of {len(eansToMod)} empty entries"
            )
        return {
            "done": True,
            "updated": updated_count,
            "total_empty": len(eansToMod),
        }

    except Exception as e:
        if logger:
            logger.error(
                f"Failed while rescanning categories in rescanCategoriesProcess: {e}"
            )
            logger.error(traceback.format_exc())
        return {"done": False, "error": str(e)}
