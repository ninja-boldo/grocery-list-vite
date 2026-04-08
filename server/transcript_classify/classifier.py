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
from typing import Any, Dict, List, Union

from transcript_classify.groceryClassifier.groceryClassifierCustom import (
    GroceryClassifier,
)
from transcript_classify.groceryClassifier.groceryClassifierLlm import (
    GroceryClassifierLlm,
)

CONFIDENCE_THRESHOLD = 0.25

# ─── Singleton instances (lazy-initialised via lru_cache in the classes) ─────

_embed_classifier = GroceryClassifier(use_reranker=False)
_llm_classifier = GroceryClassifierLlm()


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


def _normalize_classes(classes: Union[str, List[str]]) -> List[str]:
    if isinstance(classes, str):
        cls = [c.strip() for c in classes.split(",") if c.strip()]
    else:
        cls = [str(c).strip() for c in classes if str(c).strip()]
    cls = list(dict.fromkeys(cls))
    if "unknown" not in cls:
        cls.append("unknown")
    return cls


# ─── LLM-backed functions ─────────────────────────────────────────────────────


def classify(
    input_text: str,
    classes: Union[str, List[str]],
    threshold: float = CONFIDENCE_THRESHOLD,
) -> Dict[str, Any]:
    """
    Classify both category and action (add/remove) from a grocery transcript.

    Returns:
        category, category_confidence, action, action_confidence.
        Both set to "unknown" when either confidence < threshold.
    """
    return _llm_classifier.classifyTranscribe(
        input_text, _normalize_classes(classes), threshold
    )


def classify_category_only(
    input_text: str,
    classes: Union[str, List[str]],
) -> Dict[str, Any]:
    """Backwards-compatible helper: category classification only (no action)."""
    return _llm_classifier.classify_category_only(
        input_text, _normalize_classes(classes)
    )


def shortenText(input_text: str, categories: str | list[str]) -> str:
    """Normalise / shorten a single product name via LLM."""
    return _llm_classifier.shorten_text(input_text, categories)


def shortenTextBatch(
    input_items: list[str], categories: list[str] | None = None
) -> dict[str, str] | None:
    """
    Normalise many product names in a single LLM call.
    Returns {original: shortened} or None on hard failure.
    """
    return _llm_classifier.shorten_text_batch(input_items, categories or [])


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
        None, partial(_llm_classifier.classify_categories_batch, names)
    )
    return {name: {"base": tag} for name, tag in results.items()}


def mapWishItem(item_name: str, wished_items: list[str], min_conf: float = 0.8) -> str:
    """Map a scanned item to the best matching wish-list entry (cross-encoder)."""
    _ = min_conf  # kept for API compat; threshold logic lives in the classifier
    return _embed_classifier.mapWishToItem(item_name, wished_items)


def mapWishItemBatch(
    items: list[str],
    wished_items_list: list[list[str]],
    min_conf: float = 0.8,
) -> dict[str, dict]:
    """Batch cross-encoder wish mapping."""
    _ = min_conf
    return _llm_classifier.mapWishToItemBatch(items, wished_items_list)
