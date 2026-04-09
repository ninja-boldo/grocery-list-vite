# groceryClassifierLlm.py – LLM-backed grocery classifier (Groq via LangChain).
# Handles:  classify (category + action), shorten text / batch-shorten.

import json
import logging
import os
import re
from functools import lru_cache
from typing import Any, Dict, Literal, cast

from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
from pydantic import BaseModel, Field, ValidationError

from utils.types import Item

from .lookups import (
    ACTION_PROMPT_TMPL,
    COMBINED_PROMPT_TMPL,
    PROMPT_TMPL,
    SHORTEN_BATCH_TMPL,
    SHORTEN_TMPL,
    Category_Batch_TMPL,
    WISH_Batch_TMPL,
    CLASS_DESCRIPTIONS,
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

    # ── LLM / chain helpers ───────────────────────────────────────────────────

    @lru_cache(maxsize=1)  # type: ignore[misc]
    def _llm(self) -> ChatGroq:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY environment variable is not set")
        from langchain_core.utils.utils import convert_to_secret_str

        return ChatGroq(
            model=self._model,
            temperature=self._temperature,
            api_key=convert_to_secret_str(api_key),
        )

    @lru_cache(maxsize=8)  # type: ignore[misc]
    def _chain(self, template: str) -> Any:
        prompt = ChatPromptTemplate.from_template(template)
        return prompt | self._llm()

    def _invoke(self, template: str, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._chain(template).invoke(payload)
        raw = result.content if hasattr(result, "content") else str(result)
        return _parse_json(raw if isinstance(raw, str) else str(raw))

    # ── Normalisation helpers ─────────────────────────────────────────────────

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

    # ── Internal classify helpers ─────────────────────────────────────────────

    def _classify_action(self, input_text: str) -> Dict[str, Any]:
        try:
            out = self._invoke(ACTION_PROMPT_TMPL, {"input": input_text})
        except Exception as exc:
            log.warning("Action classification failed: %s", exc)
            return {"action": "unknown", "confidence": 0.0}

        action = self._normalize_action(out.get("action", "unknown"))
        conf = self._parse_confidence(out.get("confidence", 0.0))
        if action == "unknown":
            conf = min(conf, 0.2)

        try:
            v = ActionClassification(action=action, confidence=conf)  # type: ignore[arg-type]
        except ValidationError:
            v = ActionClassification(action="unknown", confidence=0.0)
        return {"action": v.action, "confidence": v.confidence}

    def _classify_category(self, input_text: str, classes: list[str]) -> Dict[str, Any]:
        try:
            out = self._invoke(
                PROMPT_TMPL, {"input": input_text, "classes": ", ".join(classes)}
            )
        except Exception as exc:
            log.warning("Category classification failed: %s", exc)
            return {"category": "unknown", "confidence": 0.0}

        cat = self._normalize_category(out.get("category", "unknown"), classes)
        conf = self._parse_confidence(out.get("confidence", 0.0))
        if cat == "unknown":
            conf = min(conf, 0.2)

        try:
            v = Classification(category=cat, confidence=conf)
        except ValidationError:
            v = Classification(category="unknown", confidence=0.0)

        if v.category not in classes:
            return {"category": "unknown", "confidence": 0.0}
        return {"category": v.category, "confidence": v.confidence}

    def _classify_combined(
        self, input_text: str, classes: list[str]
    ) -> Dict[str, Any] | None:
        """Single LLM call → category + action. Returns None on failure."""
        try:
            out = self._invoke(
                COMBINED_PROMPT_TMPL,
                {"input": input_text, "classes": ", ".join(classes)},
            )
        except Exception:
            return None

        category = self._normalize_category(out.get("category", "unknown"), classes)
        action = self._normalize_action(out.get("action", "unknown"))
        cat_conf = self._parse_confidence(
            out.get("category_confidence", out.get("confidence", 0.0))
        )
        act_conf = self._parse_confidence(out.get("action_confidence", 0.0))

        if category == "unknown":
            cat_conf = min(cat_conf, 0.2)
        if action == "unknown":
            act_conf = min(act_conf, 0.2)

        try:
            v = CombinedClassification(
                category=category,
                category_confidence=cat_conf,
                action=action,
                action_confidence=act_conf,
            )
        except ValidationError:
            return None

        if v.category not in classes:
            return None

        return {
            "category": v.category,
            "category_confidence": v.category_confidence,
            "action": v.action,
            "action_confidence": v.action_confidence,
        }

    # ── Public API ────────────────────────────────────────────────────────────

    def classifyTranscribe(
        self,
        input_text: str,
        classes: list[str],
        threshold: float = CONFIDENCE_THRESHOLD,
    ) -> Dict[str, Any]:
        """
        Classify the grocery intent from a transcript snippet.

        Returns:
          category, category_confidence, action, action_confidence.
          Both fields are set to "unknown" when either confidence < threshold.
        """
        combined = self._classify_combined(input_text, classes)

        if combined is None:
            # Fallback: two separate calls
            cat_r = self._classify_category(input_text, classes)
            act_r = self._classify_action(input_text)
            cat, cat_conf = cat_r["category"], cat_r["confidence"]
            action, act_conf = act_r["action"], act_r["confidence"]
        else:
            cat = combined["category"]
            cat_conf = combined["category_confidence"]
            action = combined["action"]
            act_conf = combined["action_confidence"]

        if cat_conf < threshold or act_conf < threshold:
            return {
                "category": "unknown",
                "category_confidence": cat_conf,
                "action": "unknown",
                "action_confidence": act_conf,
            }

        return {
            "category": cat,
            "category_confidence": cat_conf,
            "action": action,
            "action_confidence": act_conf,
        }

    def classify_category_only(
        self, input_text: str, classes: list[str]
    ) -> Dict[str, Any]:
        """Backwards-compatible helper: category classification only."""
        return self._classify_category(input_text, classes)

    def shorten_text(self, input_text: str, categories: str | list[str]) -> str:
        """Normalise / shorten a single product name."""
        categories_str = (
            ",".join(c.strip() for c in categories if c and c.strip())
            if isinstance(categories, list)
            else categories.strip()
        )
        try:
            out = self._invoke(
                SHORTEN_TMPL, {"input": input_text, "categories": categories_str}
            )
        except Exception as exc:
            log.warning("Text shortening failed: %s", exc)
            return input_text.strip()

        shortened = str(out.get("shortenedText", input_text.strip())).strip()
        return shortened or input_text.strip()

    def classify_categories_batch(
        self,
        input_items: list[str],
        classes: list[str] = list(CLASS_DESCRIPTIONS.keys()),
    ) -> dict[str, str]:
        """
        Normalise many product names in a single LLM call.
        Returns {original: shortened} or None on hard failure.
        """
        if not input_items:
            return {}

        classes_list = [str(c).strip() for c in (classes or [])]
        try:
            out = self._invoke(
                Category_Batch_TMPL,
                {"items_list": input_items, "classes_list": classes_list},
            )
        except Exception as exc:
            log.warning("Batch text shortening failed: %s", exc)
            return {}

        return {item: str(out.get(item, item)).strip() or item for item in input_items}

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
                {"items_list": input_items, "category_list": category_list},
            )
        except Exception as exc:
            log.warning("Batch text shortening failed: %s", exc)
            return None

        return {item: str(out.get(item, item)).strip() or item for item in input_items}

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
            print(f"wish item map: {wish_item_map}")
            results = self._invoke(
                WISH_Batch_TMPL,
                {"item_wish_dict": wish_item_map},
            )

            for item_name, entry in results.items():
                entry["info"] = item_info.get(item_name, {})

            parsedRes: dict = {"items": results, "wish_list_to_idx": wishToIdx}
            print(
                f"produced this wish mapping: {parsedRes}\nfor this input: {item_names}"
            )
            return parsedRes

        except Exception as exc:
            log.warning("Wish mapping failed: %s", exc)
            return {
                "items": {
                    k: {
                        "mapped_wish": "null",
                        "wish_list": [],
                        "info": item_info.get(k, {}),
                    }
                    for k in item_names
                },
                "wish_list_to_idx": {},
            }


# ─── JSON parsing utility (module-level, also exported for classifier.py) ────


def _parse_json(text: str) -> dict[str, Any]:
    """Robustly parse a JSON-like string with several fallback strategies."""
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    try:
        return json.loads(text.replace("'", '"'))
    except json.JSONDecodeError:
        pass

    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        candidate = re.sub(r",\s*}", "}", m.group())
        candidate = re.sub(r",\s*]", "]", candidate)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    return {}
