# classifier.py – Module-level API.
#
# Thin facade over GroceryClassifier (embedding) and GroceryClassifierLlm (LLM).
#
# Public surface:
#   classify()              – transcript → category + action  (LLM)
#   classify_category_only()– transcript → category only       (LLM)
#   shortenText()           – single product name normalisation (LLM)
#   shortenTextBatch()      – batch product name normalisation  (LLM, 1 call)
#   tagAssignmentBatch()    – stock items → category tags       (embedding, async)
#   mapWishItem()           – map scanned item to wish list     (embedding)
#   mapWishItemBatch()      – batch wish mapping                (embedding)
#   parse_category_list()   – parse OFF category string

import ast
import asyncio
from functools import partial
from typing import Dict, List

import asyncpg

from utils.text_processing import shortenWithTable
from utils.types_custom import (
    InternalClassification,
    Item,
    QuantityInfo,
    ShortenLlmInput,
    ShortenLlmItemSingle,
)
from transcript_classify.groceryClassifier.groceryClassifierCustom import (
    GroceryClassifier,
)
from transcript_classify.groceryClassifier.groceryClassifierLlm import (
    GroceryClassifierLlm,
)

CONFIDENCE_THRESHOLD = 0.25

# ─── Singleton instances (lazy-initialised via lru_cache in the classes) ─────

_embed_classifier: GroceryClassifier | None = None
_llm_classifier: GroceryClassifierLlm | None = None


def _get_llm_classifier() -> GroceryClassifierLlm:
    global _llm_classifier
    if _llm_classifier is None:
        _llm_classifier = GroceryClassifierLlm()
    return _llm_classifier


def _get_embed_classifier() -> GroceryClassifier:
    global _embed_classifier
    if _embed_classifier is None:
        _embed_classifier = GroceryClassifier(use_reranker=False)
    return _embed_classifier


# ─── Utility ─────────────────────────────────────────────────────────────────


def parse_category_list(category_str: str) -> List[str]:
    """
    Parse an OpenFoodFacts category string.
    Accepts: empty string | Python list literal | comma-separated string.
    Returns a clean list with 'en:' prefixes stripped and hyphens → spaces.
    """
    if not category_str or not category_str.strip():
        return []

    category_str = category_str.strip()

    if category_str.startswith("[") and category_str.endswith("]"):
        try:
            parsed = ast.literal_eval(category_str)
            if isinstance(parsed, list):
                cleaned = []
                for cat in parsed:
                    s = str(cat).strip()
                    if s.startswith("en:"):
                        s = s[3:]
                    cleaned.append(s.replace("-", " "))
                return cleaned
        except (ValueError, SyntaxError):
            pass

    return [c.strip() for c in category_str.split(",") if c.strip()]


# ─── LLM-backed functions ─────────────────────────────────────────────────────
def classifyItemsAgainstWishList(items: list[Item], wishList: list[Item]) -> dict:
    return {}


def shortenTextBatch(
    input_items: list[str], categories: list[str] | None = None
) -> dict[str, str]:
    normalToShortendTable: dict[str, str] = {}
    for idx, name in enumerate(input_items):
        shortendName = shortenWithTable(name)
        input_items[idx] = shortendName
        normalToShortendTable[shortendName] = name

    cat_list = categories or []
    items_json: ShortenLlmInput = ShortenLlmInput(
        items=[
            ShortenLlmItemSingle(
                name=item,
                categories=cat_list[i].split(",")
                if i < len(cat_list) and cat_list[i]
                else [],
            )
            for i, item in enumerate(input_items)
        ]
    )

    resClassifier = _get_llm_classifier().shorten_text_batch(items_json)

    res: dict[str, str] = {}
    for tableShortened, shortenedName in resClassifier.items():
        original = normalToShortendTable.get(tableShortened, tableShortened)
        res[original] = shortenedName
    return res


# ─── Embedding-backed functions ───────────────────────────────────────────────


async def tagAssignmentBatch(items: list[dict]) -> Dict[str, Dict[str, str]]:
    """
    Assign category tags to stock items asynchronously.
    Expects dicts with an 'item_name' key. Returns {item_name: {"base": label}}.
    """
    if not items:
        return {}

    names = [
        str(item.get("item_name", "")).strip()
        for item in items
        if str(item.get("item_name", "")).strip()
    ]
    if not names:
        return {}

    loop = asyncio.get_event_loop()
    results: dict[str, str] = await loop.run_in_executor(
        None, partial(_get_llm_classifier().classify_categories_batch, names)
    )
    return {name: {"base": tag} for name, tag in results.items()}


def mapWishItem(item_name: str, wished_items: list[str], min_conf: float = 0.8) -> str:
    """Map a scanned item to the best matching wish-list entry (cross-encoder)."""
    _ = min_conf  # kept for API compat; threshold logic lives in the classifier
    return _get_embed_classifier().mapWishToItem(item_name, wished_items)


def mapWishItemBatch(
    items: list[str],
    wished_items_list: list[list[str]],
) -> dict[str, dict]:
    """Batch wish mapping."""
    return _get_llm_classifier().mapWishToItemBatch(items, wished_items_list)


async def getCachedMappings(
    con: asyncpg.pool.PoolConnectionProxy, ingredients: list[Item], userId: int
):
    ingredient_ids = [int(ing.item_id) for ing in ingredients]

    rows = await con.fetch(
        """
        SELECT ing.amount AS ingredient_amount,
            ing.unit AS ingredient_unit,
            ing_map.ingredient_id AS ingredient_id,
            ing.name AS ingredient_name,
            it.unit AS item_unit,
            it.amount AS item_amount,
            inv.count AS count,
            ing_map.item_id AS item_id,
            it.item_name AS item_name
        FROM ingredient_item_map ing_map
        JOIN ingredients ing ON ing.ingredient_id = ing_map.ingredient_id
        JOIN inventory inv ON inv.item_id = ing_map.item_id
        JOIN items it ON it.item_id = ing_map.item_id
        WHERE inv.user_id = $1
        AND ing_map.ingredient_id = ANY($2::int[])
        """,
        userId,
        ingredient_ids,
    )

    mappings = [
        InternalClassification(
            pantryItem=Item(
                item_name=row["item_name"],
                item_id=str(row["item_id"]),
                count=row["count"],
                quantity=QuantityInfo(
                    product_quantity=row["item_amount"],
                    product_quantity_unit=row["item_unit"],
                ),
            ),
            mappedWishItem=Item(
                item_name=row["ingredient_name"],
                item_id=str(row["ingredient_id"]),
                count=-1,
                quantity=QuantityInfo(
                    product_quantity=row["item_amount"],
                    product_quantity_unit=row["item_unit"],
                ),
            ),
            foundMappingWish=True,
        )
        for row in rows
    ]
    return mappings


def filterNeededIngredients(
    mapping: list[InternalClassification], ingredientsNeeded: list[Item]
) -> list[Item]:

    idToItemMap: dict[str, Item] = {}
    ingredientNeedMap: dict[str, int] = {}
    # prefill map
    for ing in ingredientsNeeded:
        ingredientNeedMap[ing.item_id] = ing.quantity.product_quantity or 0
        idToItemMap[ing.item_id] = ing

    for map in mapping:
        if map.foundMappingWish:
            ingId = map.mappedWishItem.item_id  # type: ignore
            alreadyInStockAmount = (
                map.pantryItem.quantity.product_quantity or 0
            ) * map.pantryItem.count
            ingredientNeedMap[ingId] -= alreadyInStockAmount

    itemsStillNeeded: list[Item] = []
    for ingId in ingredientNeedMap.keys():
        remainingNeed = ingredientNeedMap[ingId]
        if remainingNeed > 0:
            ing: Item = idToItemMap[ingId]
            ing.quantity.product_quantity = remainingNeed
            itemsStillNeeded.append(ing)

    return itemsStillNeeded


async def classifyWishAgainstPantry(
    con: asyncpg.pool.PoolConnectionProxy,
    pantryItems: list[Item],
    ingredientsNeeded: list[Item],
    userId: int,
) -> list[InternalClassification]:

    print(
        f"pantryItems: {pantryItems}\ningredientsNeeded: {ingredientsNeeded}\nuserId: {userId}"
    )

    # at first get
    mapping: list[InternalClassification] = await getCachedMappings(
        con, ingredientsNeeded, userId
    )
    # llm classified
    print(f"cached mapping: {[m.model_dump() for m in mapping]}")

    stillNeededIngredients = filterNeededIngredients(mapping, ingredientsNeeded)
    print(
        f"still needed ingredients: {[m.model_dump() for m in stillNeededIngredients]}"
    )
    llmRes: list[InternalClassification] = (
        _get_llm_classifier().classifyWishAgainstPantry(
            stillNeededIngredients,
            pantryItems,
        )
    )
    print(f"llm res: {[m.model_dump() for m in llmRes]}")

    mapping.extend(llmRes)  # combine the lists

    print(
        f"now returning this mapping in classifyWishAgainstPantry: {[m.model_dump() for m in mapping]}"
    )

    return mapping
