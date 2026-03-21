import datetime
import json
from typing import Optional

import asyncpg
import requests
from fastapi import HTTPException


async def resolve_item_identity(
    con: asyncpg.Connection,
    ean: Optional[str],
    item_name: Optional[str],
    logger=None,
) -> tuple[str, str]:
    if ean and item_name:
        return (ean, item_name)

    if ean and not item_name:
        try:
            res = requests.get(
                f"https://world.openfoodfacts.net/api/v2/product/{ean}?fields=product_name",
                timeout=5.0,
            )
            data = res.json()
            if data.get("status") == 1:
                product_name = data.get("product", {}).get("product_name")
                if product_name:
                    return (ean, product_name)
        except Exception as exc:
            if logger:
                logger.warning("OpenFoodFacts lookup failed for ean %s: %s", ean, exc)

        return (ean, "none")

    if item_name and not ean:
        row = await con.fetchrow(
            "SELECT ean FROM item_list WHERE item_name = $1 LIMIT 1", item_name
        )
        return (row["ean"] if row else "0", item_name)

    raise HTTPException(status_code=400, detail="Must provide ean or item_name")


async def perform_item_operation(
    con: asyncpg.Connection,
    item_name: str,
    ean: str = "0",
    count_delta: int = 1,
    subgroups: str = "none",
    is_wish_list: str = "false",
    image_url: str = "",
) -> str:
    current_time = datetime.datetime.now().isoformat()

    existing = await con.fetchrow(
        "SELECT count, timestamps FROM item_list WHERE item_name = $1", item_name
    )

    if not existing:
        if count_delta <= 0:
            return "skipped"

        timestamps = [current_time] * count_delta
        await con.execute(
            """INSERT INTO item_list
               (ean, item_name, subgroups, class, count, timestamps, iswished, image_url)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
            ean,
            item_name,
            subgroups,
            "",
            count_delta,
            json.dumps(timestamps),
            is_wish_list,
            image_url,
        )
        return "created"

    existing_count = existing["count"]
    existing_ts = json.loads(existing["timestamps"] or "[]")

    if count_delta < 0:
        to_remove = min(abs(count_delta), existing_count)
        new_ts = existing_ts[to_remove:]
        new_count = existing_count - to_remove
    else:
        new_ts = existing_ts + [current_time] * count_delta
        new_count = existing_count + count_delta

    if new_count <= 0:
        await con.execute("DELETE FROM item_list WHERE item_name = $1", item_name)
        return "deleted"

    await con.execute(
        "UPDATE item_list SET count = $1, timestamps = $2 WHERE item_name = $3",
        new_count,
        json.dumps(new_ts),
        item_name,
    )
    return "updated"
