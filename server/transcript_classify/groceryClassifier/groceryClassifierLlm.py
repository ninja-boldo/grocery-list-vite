# groceryClassifierLlm.py – LLM-backed grocery classifier

import json
import logging
import traceback
import dotenv
from typing import Any, Literal, cast

from openai import OpenAI
from pydantic import BaseModel, Field

try:
    from rich.console import Console
    from rich.json import JSON as RichJSON
except ImportError:
    Console = None
    RichJSON = None

from utils.types_custom import (
    ClassificationWishListVsPantryInternal,
    InternalClassification,
    Item,
    ShortenLlmInput,
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


# ─── Configuration Variables ─────────────────────────────────────────────────
def _get_model_config() -> tuple[str, str]:
    model = dotenv.get_key(".env", "MODEL")
    base_url = dotenv.get_key(".env", "OPENAI_API_BASE_URL")
    if not model or not base_url:
        raise ValueError(
            f"you gotta set both MODEL and BASE_URL \nMODEL = {model} \nBASE_URL = {base_url}"
        )
    return model, base_url


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
      classify_categories_batch() – category mapping
      shorten_text_batch()        – normalise many product names
      mapWishToItemBatch()        – batch wish mapping
      classifyWishAgainstPantry() – classify wishes against pantry items
    """

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        temperature: float = 0.1,
    ):
        if model is None or base_url is None:
            model, base_url = _get_model_config()
        self._model = model
        self._base_url = base_url
        self._temperature = temperature
        self._client = OpenAI(
            base_url=self._base_url, api_key=dotenv.get_key(".env", "API_KEY")
        )

    # ── LLM / chain helpers ───────────────────────────────────────────────────

    def _invoke(
        self,
        template: dict,
        responseFormat: dict,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = self._client.chat.completions.create(
            model=self._model,
            temperature=self._temperature,
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

        return self._parse_json_content(content)

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

    def shorten_text_batch(self, items: ShortenLlmInput) -> dict[str, str]:
        try:
            out = self._invoke(
                SHORTEN_BATCH_TMPL,
                response_format_shorten_names_batch,
                {"items": json.dumps(items.model_dump(), ensure_ascii=False)},
            )
        except Exception as exc:
            log.warning(
                "Batch text shortening failed: %s\n with this traceback %s",
                exc,
                traceback.format_exc(),
            )
            return {}

        out_map = self._rows_to_map(out.get("items"), "original_name", "shortend_name")
        lower_map = {k.lower().strip(): v for k, v in out_map.items()}

        return {
            item.name: (lower_map.get(item.name.lower().strip(), item.name)).strip()
            or item.name
            for item in items.items
        }

    def convertWishList(self, wishList: list[str]) -> str:
        wishList.sort()
        return ",".join(wishList)

    def mapWishToItemBatch(
        self,
        items: list[str] | list[Item],
        wish_lists: list[list[str]] | None = None,
    ) -> dict[str, dict]:
        """Batch llm wish mapping"""

        if not items:
            return {}

        normalized: list[tuple[str, dict]] = []
        for item in items:
            if isinstance(item, Item):
                normalized.append(
                    (item.item_name, item.model_dump(exclude={"item_name"}))
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

            return {"items": results, "wish_list_to_idx": wishToIdx}

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
        # `items` are wished items, `wishList` is the current pantry.
        # Provide full item payloads so the model can preserve stable IDs from input.
        payload = {
            "pantryItems": [w.model_dump() for w in wishList],
            "wishItems": [it.model_dump() for it in items],
        }
        result: dict = self._invoke(
            CLASSIFY_AGAINST_PANTRY_TMPL,
            response_format_classify_against_pantry,
            payload,
        )
        parsed: ClassificationWishListVsPantryInternal = (
            ClassificationWishListVsPantryInternal.model_validate(result)
        )

        pantry_by_id = {p.item_id: p for p in wishList}
        pantry_by_name = {
            p.item_name.strip().lower(): p for p in wishList if p.item_name
        }
        items_by_id = {i.item_id: i for i in items}
        items_by_name = {i.item_name.strip().lower(): i for i in items if i.item_name}

        results = []
        for m in parsed.mappings:
            pantry_item = pantry_by_id.get(m.pantryItem.item_id)
            if pantry_item is None and m.pantryItem.item_name:
                pantry_item = pantry_by_name.get(m.pantryItem.item_name.strip().lower())
            if pantry_item is None:
                from utils.types_custom import Item as ItemType
                from utils.types_custom import QuantityInfo as QuantityInfoType

                pantry_item = ItemType(
                    item_name=m.pantryItem.item_name,
                    item_id=m.pantryItem.item_id,
                    count=1,
                    quantity=QuantityInfoType(
                        product_quantity=None, product_quantity_unit=None
                    ),
                )

            mapped_item = None
            if m.foundMappingWish and m.mappedWishItem:
                mapped_id = getattr(m.mappedWishItem, "item_id", None)
                if mapped_id:
                    mapped_item = items_by_id.get(mapped_id)

                if mapped_item is None and m.mappedWishItem.item_name:
                    mapped_item = items_by_name.get(
                        m.mappedWishItem.item_name.strip().lower()
                    )

            found_mapping = mapped_item is not None
            if m.foundMappingWish and not found_mapping:
                log.warning(
                    "LLM reported foundMappingWish=true but no wished item could be resolved "
                    "(pantry=%s, mapped=%s)",
                    m.pantryItem.item_name,
                    m.mappedWishItem.item_name if m.mappedWishItem else None,
                )

            results.append(
                InternalClassification.model_validate(
                    dict(
                        pantryItem=pantry_item,
                        mappedWishItem=mapped_item,
                        foundMappingWish=found_mapping,
                    )
                )
            )
        return results


if __name__ == "__main__":
    g = GroceryClassifierLlm()
    res = g.classify_categories_batch(["joghurt", "ben und jerrys", "rice", "huevos"])
    print(res)
