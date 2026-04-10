# groceryClassifierLlm.py – LLM-backed grocery classifier

import json
import logging
from typing import Any, Literal, cast

from groq import Groq
from pydantic import BaseModel, Field

try:
    from rich.console import Console
    from rich.json import JSON as RichJSON
except Exception:
    Console = None
    RichJSON = None

from utils.types import (
    ClassificationWishListVsPantryInternal,
    InternalClassification,
    Item,
)

from .lookups import (
    CLASSIFY_AGAINST_PANTRY_TMPL,
    SHORTEN_BATCH_TMPL,
    Category_Batch_TMPL,
    WISH_Batch_TMPL,
    CLASS_DESCRIPTIONS,
    response_format_map_wish_list,
    response_format_classify_item,
    response_format_shorten_names_batch,
    response_format_classify_against_pantry,
)

log = logging.getLogger(__name__)

GROQ_MODEL = "openai/gpt-oss-20b"
CONFIDENCE_THRESHOLD = 0.25

# ─── Pydantic result models ──────────────────────────────────────────────────


class Classification(BaseModel):
    category: str
    confidence: float = Field(ge=0.0, le=1.0)


class ActionClassification(BaseModel):
    action: Literal["add", "remove", "unknown"]
    confidence: float = Field(ge=0.0, le=1.0)


class CombinedClassification(BaseModel):
    category: str
    category_confidence: float = Field(ge=0.0, le=1.0)
    action: Literal["add", "remove", "unknown"]
    action_confidence: float = Field(ge=0.0, le=1.0)


# ─── Classifier ──────────────────────────────────────────────────────────────


class GroceryClassifierLlm:
    """
    LLM-backed classifier for grocery transcript intents.

    Primary entry points:
      classify()          – category + action in one call (with fallback)
      shorten_text()      – normalise a single product name
      shorten_text_batch() – normalise many product names in one LLM call
    """

    def __init__(self, model: str = GROQ_MODEL, temperature: float = 0.1):
        self._model = model
        self._temperature = temperature
        self._client = Groq()

    # ── LLM / chain helpers ───────────────────────────────────────────────────

    def _invoke(
        self,
        template: dict,
        responseFormat: dict,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": f"{template.get('system')}"},
                {
                    "role": "user",
                    "content": f"{self.fill_template(template.get('user'), payload)}",
                },
            ],
            response_format=cast(Any, responseFormat),
        )

        content = response.choices[0].message.content
        if content is None:
            raise ValueError("LLM returned empty content")

        result = self._parse_json_content(content)
        return result

    @staticmethod
    def _parse_json_content(content: str) -> dict[str, Any]:
        """Parse model output robustly, including fenced JSON responses."""
        text = content.strip()
        if text.startswith("```"):
            parts = text.split("\n")
            if parts and parts[0].startswith("```"):
                parts = parts[1:]
            if parts and parts[-1].strip() == "```":
                parts = parts[:-1]
            text = "\n".join(parts).strip()
            if text.lower().startswith("json"):
                text = text[4:].strip()

        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError("LLM response is not a JSON object")
        return parsed

    # ── Normalisation helpers ─────────────────────────────────────────────────
    def fill_template(self, template, data) -> str:
        return template.format(**data)

    @staticmethod
    def _as_dict(value: Any) -> dict[str, Any]:
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _print_json_debug(title: str, payload: dict[str, Any]) -> None:
        """Render debug payload as pretty JSON, using Rich when available."""
        pretty = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)

        if Console is not None and RichJSON is not None:
            console = Console()
            console.print(f"[bold cyan]{title}[/bold cyan]")
            console.print(RichJSON(pretty))
            return

        print(f"{title}:\n{pretty}")

    @staticmethod
    def _parse_confidence(value: Any) -> float:
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _normalize_action(action: Any) -> Literal["add", "remove", "unknown"]:
        s = str(action).strip().lower()
        if s in {"add", "remove", "unknown"}:
            return cast(Literal["add", "remove", "unknown"], s)
        return "unknown"

    @staticmethod
    def _normalize_category(category: Any, classes: list[str]) -> str:
        lower_map = {c.lower(): c for c in classes}
        return lower_map.get(str(category).strip().lower(), "unknown")

    @staticmethod
    def _rows_to_map(rows: Any, key: str, value: str) -> dict[str, Any]:
        """Convert LLM array response to {item: value} dict."""
        if not isinstance(rows, list):
            return {}
        return {
            r[key]: r[value]
            for r in rows
            if isinstance(r, dict) and key in r and value in r
        }

    # ── Public API ────────────────────────────────────────────────────────────

    """
    def classifyItemsAgainstWishList(
        self, items: list[Item], wishList: list[Item]
    ) -> ClassificationWishListVsPantryInternal:
        
        """

    def classify_categories_batch(
        self,
        input_items: list[str],
        classes: list[str] = list(CLASS_DESCRIPTIONS.keys()),
    ) -> dict[str, str]:
        """
        Classify many items into categories in a single LLM call.
        Returns {original: category}.
        """
        if not input_items:
            return {}

        classes_list = [str(c).strip() for c in (classes or [])]
        try:
            out = self._invoke(
                Category_Batch_TMPL,
                response_format_classify_item,
                {"items_list": input_items, "classes_list": classes_list},
            )
        except Exception as exc:
            log.warning("Batch category classification failed: %s", exc)
            return {}

        out_map = self._rows_to_map(out.get("items"), "item", "category")
        allowed_classes = set(classes_list)

        return {
            item: (
                str(out_map.get(item, "")).strip()
                if str(out_map.get(item, "")).strip() in allowed_classes
                else "other"
            )
            for item in input_items
        }

    def shorten_text_batch(
        self, input_items: list[str], categories: list[str] | None = None
    ) -> dict[str, str] | None:
        """
        Normalise many product names in a single LLM call.
        Returns {original: shortened} or None on hard failure.
        """
        if not input_items:
            return {}

        category_list = [str(c).strip() for c in (categories or [])]
        try:
            out = self._invoke(
                SHORTEN_BATCH_TMPL,
                response_format_shorten_names_batch,
                {"items_list": input_items, "category_list": category_list},
            )
        except Exception as exc:
            log.warning("Batch text shortening failed: %s", exc)
            return None

        out_map = self._rows_to_map(out.get("items"), "item", "normalized")
        return {
            item: str(out_map.get(item, item)).strip() or item for item in input_items
        }

    def convertWishList(self, wishList: list[str]) -> str:
        wishList.sort()
        wishesStr = ",".join(wishList)
        return wishesStr

    def mapWishToItemBatch(
        self,
        items: list[str] | list[Item],
        wish_lists: list[list[str]] | None = None,
    ) -> dict[str, dict]:
        """Batch llm wish mapping"""

        if not items:
            return {}

        # Normalize to (item_name, info_dict) pairs
        normalized: list[tuple[str, dict]] = []
        for item in items:
            if isinstance(item, Item):
                normalized.append(
                    (
                        item.item_name,
                        item.model_dump(exclude={"item_name"}),
                    )
                )
            else:
                normalized.append((item, {}))

        item_names = [name for name, _ in normalized]
        item_info = {name: info for name, info in normalized}

        prepared_wishes = list(wish_lists or [])
        if len(prepared_wishes) < len(item_names):
            prepared_wishes.extend(
                [[] for _ in range(len(item_names) - len(prepared_wishes))]
            )
        else:
            prepared_wishes = prepared_wishes[: len(item_names)]

        wishToIdx: dict[str, int] = {}
        idx: int = 0
        for wishList in prepared_wishes:
            wishesStr = self.convertWishList(wishList)
            if wishesStr not in wishToIdx:
                wishToIdx[wishesStr] = idx
                idx += 1

        wish_item_map: dict[str, dict] = {}
        for item_name, wishes in zip(item_names, prepared_wishes):
            wishesStr = self.convertWishList(wishes)
            wish_item_map[item_name] = {
                "wish_list": wishes,
                "index_wish_list": wishToIdx[wishesStr],
            }

        try:
            self._print_json_debug("wish item map", wish_item_map)
            raw_results = self._invoke(
                WISH_Batch_TMPL,
                response_format_map_wish_list,
                {"item_wish_dict": wish_item_map},
            )

            rows = raw_results.get("items", [])
            results_obj: dict[str, dict] = {
                r["item"]: r for r in rows if isinstance(r, dict) and "item" in r
            }

            results: dict[str, dict[str, Any]] = {}
            for item_name in item_names:
                wishes = wish_item_map[item_name]["wish_list"]
                fallback_idx = wish_item_map[item_name]["index_wish_list"]
                entry = results_obj.get(item_name, {})

                mapped_wish = str(entry.get("mapped_wish", "null")).strip() or "null"
                if wishes and mapped_wish not in wishes:
                    mapped_wish = "other" if "other" in wishes else wishes[0]

                idx_value = entry.get(
                    "index_wish_list",
                    entry.get("wish_list_index", fallback_idx),
                )
                try:
                    parsed_idx = int(idx_value)
                except (TypeError, ValueError):
                    parsed_idx = fallback_idx

                results[item_name] = {
                    "mapped_wish": mapped_wish,
                    "index_wish_list": parsed_idx,
                    "wish_list": wishes,
                    "info": item_info.get(item_name, {}),
                }

            parsedRes: dict = {"items": results, "wish_list_to_idx": wishToIdx}
            # self._print_json_debug("wish mapping results", parsedRes)
            return parsedRes

        except Exception as exc:
            log.warning("Wish mapping failed: %s", exc)
            return {
                "items": {
                    k: {
                        "mapped_wish": "null",
                        "index_wish_list": wish_item_map[k]["index_wish_list"],
                        "wish_list": wish_item_map[k]["wish_list"],
                        "info": item_info.get(k, {}),
                    }
                    for k in item_names
                },
                "wish_list_to_idx": {},
            }

    def classifyWishAgainstPantry(
        self, items: list[Item], wishList: list[Item]
    ) -> list[InternalClassification]:
        result: dict = self._invoke(
            CLASSIFY_AGAINST_PANTRY_TMPL,
            response_format_classify_against_pantry,
            {"items": [it.item_name for it in items], "wishList": [w.item_name for w in wishList]},
        )
        parsed: ClassificationWishListVsPantryInternal = (
            ClassificationWishListVsPantryInternal.model_validate(result)
        )
        return parsed.mappings


if __name__ == "__main__":
    g = GroceryClassifierLlm()

    res = g.classify_categories_batch(["joghurt", "ben und jerrys", "rice", "huevos"])
    print(res)
