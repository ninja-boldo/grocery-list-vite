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

from server.utils.helpers_other import logModel
from utils.types_custom import (
    ClassificationWishListVsPantryInternal,
    ExpiryDateEstimationResponse,
    InternalClassification,
    Item,
    MappedWish,
    PantryAndWishes,
    QuantityInfo,
    ShortenLlmInput,
    WishMapResponse,
)

from .lookups import (
    CLASSIFY_AGAINST_PANTRY_TMPL,
    CLASSIFY_EXPIRY_DAYS_TMPL,
    SHORTEN_BATCH_TMPL,
    Category_Batch_TMPL,
    CLASS_DESCRIPTIONS,
    response_format_classify_item,
    response_format_shorten_names_batch,
    response_format_classify_against_pantry,
    response_format_expiry_estimation,
)

log = logging.getLogger(__name__)

dotenv.load_dotenv(override=True)



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
        processName: str = "unknown",
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

        logModel(response, processName, self._base_url)
        
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
                "classify_categories_batch",
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
                "shorten_text_batch",
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

    def estimateExpiryDays(self, items: list[Item]) -> ExpiryDateEstimationResponse:

        if len(items) == 0:
            return ExpiryDateEstimationResponse(mappings=[])

        payloadStr: str = "["
        for item in items:
            payloadStr += item.model_dump_json()
        payloadStr += "]"

        res: dict = self._invoke(
            CLASSIFY_EXPIRY_DAYS_TMPL,
            response_format_expiry_estimation,
            {"items": payloadStr},
            "estimateExpiryDays",
        )
        resParsed: ExpiryDateEstimationResponse = (
            ExpiryDateEstimationResponse.model_validate(res)
        )

        return resParsed

    def convertWishList(self, wishList: list[str]) -> str:
        wishList.sort()
        return ",".join(wishList)

    def mapWishToItemBatch(
        self, userToPantryToWish: dict[int, PantryAndWishes], itemIdNameMapping: dict
    ) -> WishMapResponse:
        """Batch llm wish mapping"""
        if not userToPantryToWish.keys():
            return WishMapResponse(items=[])

        pantryWishCombis: list[PantryAndWishes] = []
        for user in userToPantryToWish.keys():
            pantryWishCombis.append(userToPantryToWish[user])

        payloadStr: str = "["
        for comb in pantryWishCombis:
            pantryList = [
                {"item_name": itemIdNameMapping[c], "item_id": c} for c in comb.pantry
            ]
            wishList = [
                {"item_name": itemIdNameMapping[c], "item_id": c} for c in comb.wishList
            ]
            dictVersion = {"pantry": pantryList, "wishList": wishList}
            payloadStr += str(dictVersion)
        payloadStr += "]"
        res: dict = self._invoke(
            CLASSIFY_AGAINST_PANTRY_TMPL,
            response_format_classify_against_pantry,
            {"pantryWishStr": payloadStr},
            "mapWishToItemBatch",
        )
        resParsed: ClassificationWishListVsPantryInternal = (
            ClassificationWishListVsPantryInternal.model_validate(res)
        )

        response: WishMapResponse = WishMapResponse(items=[])
        for map in resParsed.mappings:
            if map.mappedWishItem is None:
                pass
            else:
                pantry: Item = map.pantryItem
                wish: Item = map.mappedWishItem
                confidence: float = map.confidence

                response.items.append(
                    MappedWish(
                        item=Item(
                            item_name=pantry.item_name,
                            item_id=pantry.item_id,
                            count=pantry.count,
                            quantity=QuantityInfo(
                                product_quantity=pantry.quantity.product_quantity,
                                product_quantity_unit=pantry.quantity.product_quantity_unit,
                            ),
                        ),
                        mapped_wish=Item(
                            item_name=wish.item_name,
                            item_id=wish.item_id,
                            count=wish.count,
                            quantity=QuantityInfo(
                                product_quantity=wish.quantity.product_quantity,
                                product_quantity_unit=wish.quantity.product_quantity_unit,
                            ),
                        ),
                        confidence=confidence,
                    )
                )

        return response

    def classifyWishAgainstPantry(
        self, items: list[Item], wishList: list[Item]
    ) -> list[InternalClassification]:
        # `items` are wished items, `wishList` is the current pantry.
        if not items:
            return []
        dictVersion = {
            "pantry": [w.model_dump() for w in wishList],
            "wishList": [it.model_dump() for it in items],
        }
        payloadStr = str([dictVersion])

        result: dict = self._invoke(
            CLASSIFY_AGAINST_PANTRY_TMPL,
            response_format_classify_against_pantry,
            {"pantryWishStr": payloadStr},
            "classifyWishAgainstPantry",
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
            if m.mappedWishItem:
                mapped_id = getattr(m.mappedWishItem, "item_id", None)
                if mapped_id:
                    mapped_item = items_by_id.get(mapped_id)

                if mapped_item is None and m.mappedWishItem.item_name:
                    mapped_item = items_by_name.get(
                        m.mappedWishItem.item_name.strip().lower()
                    )

            found_mapping = mapped_item is not None

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
