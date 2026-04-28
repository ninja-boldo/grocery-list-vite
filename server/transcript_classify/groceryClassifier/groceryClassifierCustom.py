# groceryClassifierCustom.py – Embedding-based grocery category classifier.
# Uses bi-encoder (sentence-transformers) for fast batch classification and an
# optional cross-encoder reranker for ambiguous / short items.
'''
import logging
from functools import lru_cache
from typing import Any, Optional

import numpy as np
from sentence_transformers import SentenceTransformer
from sentence_transformers.cross_encoder import CrossEncoder

from .lookups import (
    CLASS_DESCRIPTIONS,
    OFF_TO_BUCKET,
    RERANKER_LABEL_TEXTS,
    GRAM_WEIGHT_RE,
    SAUCE_NEIGHBOURS,
    BROTH_TOKENS,
    SINGLE_WORD_OVERRIDES,
    MULTI_WORD_OVERRIDE_ITEMS,
    PREFIX_OVERRIDES_BY_HEAD,
    normalize_for_match,
)

log = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

DEFAULT_RUNTIME_THRESHOLD = 0.25
DEFAULT_RERANKER_MARGIN = 0.05
DEFAULT_CATEGORIES_MODEL_PATH = "ghost-beard-9942/multilingual-e5-base-custom-finetune"
DEFAULT_WISH_MODEL_PATH = "other/models/wish-mapper-model"
RERANKER_MODEL = "Alibaba-NLP/gte-reranker-modernbert-base"
SHORT_ITEM_THRESHOLD = 12
SHORT_ITEM_RERANKER_MARGIN = 0.10


# ─── Cached model loaders ────────────────────────────────────────────────────


@lru_cache(maxsize=4)
def get_bi_encoder(
    model_path: str,
) -> tuple[SentenceTransformer, np.ndarray, list[str]]:
    log.info("Loading bi-encoder from %s …", model_path)
    model = SentenceTransformer(model_path)
    class_slugs = list(CLASS_DESCRIPTIONS.keys())
    class_embs = model.encode(
        [f"passage: {d}" for d in CLASS_DESCRIPTIONS.values()],
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    log.info("Bi-encoder ready. %d classes.", len(class_slugs))
    return model, class_embs, class_slugs


@lru_cache(maxsize=4)
def get_cross_encoder(model_path: str) -> CrossEncoder:
    log.info("Loading cross-encoder %s …", model_path)
    ce = CrossEncoder(model_path)
    log.info("Cross-encoder ready.")
    return ce


# ─── Classifier ──────────────────────────────────────────────────────────────


class GroceryClassifier:
    """
    Classify grocery items into predefined categories.

    Pipeline per item:
      1. Keyword override  – deterministic, cheap, handles known edge-cases
      2. Bi-encoder        – fast batch embedding for the bulk
      3. Cross-encoder     – fires when bi-encoder margin is thin or item is short
    """

    def __init__(
        self,
        threshold: float = DEFAULT_RUNTIME_THRESHOLD,
        reranker_margin: float = DEFAULT_RERANKER_MARGIN,
        fallback_label: str = "other",
        wish_model_path: str = DEFAULT_WISH_MODEL_PATH,
        use_reranker: bool = True,
        reranker_model: str = RERANKER_MODEL,
    ):
        self._threshold = threshold
        self._reranker_margin = reranker_margin
        self._fallback_label = fallback_label
        self._wish_model_path = wish_model_path
        self._use_reranker = use_reranker
        self._reranker_model = reranker_model
        self._wish_model: Any | None = None
        self.OFF_TO_BUCKET = OFF_TO_BUCKET

    # ── Internal helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _normalize(text: str) -> str:
        return normalize_for_match(text)

    def _keyword_classify(self, item: str) -> Optional[str]:
        norm = self._normalize(item)
        if not norm:
            return None

        tokens_list = norm.split()
        tokens = set(tokens_list)

        if "paprika" in tokens and "frisch" not in tokens and "fresh" not in tokens:
            if GRAM_WEIGHT_RE.search(norm):
                return "spices herbs seasoning"

        if "tk" in tokens:
            return "frozen foods"

        if "eis" in tokens:
            return "frozen foods"

        if any(t.startswith("salat") for t in tokens):
            if not tokens & SAUCE_NEIGHBOURS:
                return "fruit vegetables"

        if tokens & BROTH_TOKENS:
            return "spices herbs seasoning"

        for token in tokens:
            exact = SINGLE_WORD_OVERRIDES.get(token)
            if exact is not None:
                return exact

            prefix_candidates = PREFIX_OVERRIDES_BY_HEAD.get(token[0])
            if prefix_candidates:
                for prefix, label in prefix_candidates:
                    if token.startswith(prefix):
                        return label

        padded = f" {norm} "
        for phrase, label in MULTI_WORD_OVERRIDE_ITEMS:
            if f" {phrase} " in padded:
                return label

        return None

    @lru_cache(maxsize=1)
    def _load_model(self) -> tuple[SentenceTransformer, np.ndarray, list[str]]:
        return get_bi_encoder(DEFAULT_CATEGORIES_MODEL_PATH)

    def _load_reranker(self) -> CrossEncoder:
        return get_cross_encoder(self._reranker_model)

    def _load_wish_model(self) -> SentenceTransformer:
        if self._wish_model is None:
            self._wish_model = SentenceTransformer(self._wish_model_path)
        return self._wish_model

    @staticmethod
    def _top_k_indices(row: np.ndarray, top_k: int) -> np.ndarray:
        k = min(top_k, row.shape[0])
        idx = np.argpartition(row, -k)[-k:]
        return idx[np.argsort(row[idx])[::-1]]

    def _embed_classify(self, items: list[str]) -> dict[str, str]:
        model, class_embs, class_slugs = self._load_model()
        item_embs = model.encode(
            [f"query: {item}" for item in items],
            normalize_embeddings=True,
            show_progress_bar=False,
            batch_size=64,
        )
        scores = item_embs @ class_embs.T

        results: dict[str, str] = {}
        rerank_batch: list[tuple[str, list[str]]] = []

        for item, row in zip(items, scores):
            top_indices = self._top_k_indices(row, 3)
            top3 = [(class_slugs[i], float(row[i])) for i in top_indices]

            best_score = top3[0][1]
            margin = top3[0][1] - top3[1][1] if len(top3) > 1 else 1.0

            if best_score < self._threshold:
                results[item] = self._fallback_label
                continue

            if self._use_reranker:
                effective_margin = (
                    SHORT_ITEM_RERANKER_MARGIN
                    if len(item) < SHORT_ITEM_THRESHOLD
                    else self._reranker_margin
                )
                if margin < effective_margin:
                    rerank_batch.append((item, [label for label, _ in top3]))
                    continue

            results[item] = top3[0][0]

        if rerank_batch:
            ce = self._load_reranker()
            all_pairs: list[tuple[str, str]] = []
            group_sizes: list[int] = []

            for item, labels in rerank_batch:
                all_pairs.extend(
                    (item, RERANKER_LABEL_TEXTS[label]) for label in labels
                )
                group_sizes.append(len(labels))

            all_scores = ce.predict(all_pairs)

            offset = 0
            for (item, labels), size in zip(rerank_batch, group_sizes):
                ce_scores = all_scores[offset : offset + size]
                best_idx = int(np.argmax(ce_scores))
                results[item] = labels[best_idx]
                offset += size

        return results

    # ── Public API ────────────────────────────────────────────────────────────

    def classifyCategoriesBatch(self, items: list[str]) -> dict[str, str]:
        """
        Classify a list of item name strings → {item_name: category_label}.
        Deduplicates internally for efficiency.
        """
        if not items:
            return {}

        unique_items = list(dict.fromkeys(items))
        unique_results: dict[str, str] = {}
        needs_embedding: list[str] = []

        for item in unique_items:
            label = self._keyword_classify(item)
            if label is not None:
                unique_results[item] = label
            else:
                needs_embedding.append(item)

        if needs_embedding:
            unique_results.update(self._embed_classify(needs_embedding))

        return {item: unique_results[item] for item in items}

    def classifyStockItems(self, items: list[dict]) -> dict[str, str]:
        """
        Classify raw stock-item dicts from the /stock endpoint.
        Prefers `shortened_name`, falls back to `text`. Returns {ean: label}.
        """
        if not items:
            return {}
        texts = [item.get("shortened_name") or item["text"] for item in items]
        label_map = self.classifyCategoriesBatch(texts)
        return {item["ean"]: label_map[text] for item, text in zip(items, texts)}

    def classifyCategoriesBatchTopK(
        self, items: list[str], top_k: int = 3
    ) -> dict[str, list[str]]:
        """Return top-k category candidates per item (keyword override placed first)."""
        if not items:
            return {}
        if top_k < 1:
            raise ValueError("top_k must be >= 1")

        unique_items = list(dict.fromkeys(items))
        model, class_embs, class_slugs = self._load_model()
        item_embs = model.encode(
            [f"query: {item}" for item in unique_items],
            normalize_embeddings=True,
            show_progress_bar=False,
            batch_size=64,
        )
        scores = item_embs @ class_embs.T
        unique_topk: dict[str, list[str]] = {}

        for row_idx, item in enumerate(unique_items):
            row = scores[row_idx]
            top_indices = self._top_k_indices(row, top_k)
            ranked = [class_slugs[i] for i in top_indices]

            keyword_label = self._keyword_classify(item)
            if keyword_label is not None:
                ranked = [keyword_label] + [l for l in ranked if l != keyword_label]  # noqa: E741

            unique_topk[item] = ranked[:top_k]

        return {item: unique_topk[item] for item in items}

    def mapWishToItem(self, item_name: str, wished_items: list[str]) -> str:
        """Map a single scanned item to the best matching wish-list entry."""
        mapped = self.mapWishToItemBatch([item_name], [wished_items])
        return mapped[0] if mapped else item_name

    def mapWishToItemBatch(
        self,
        items: list[str],
        wish_lists: list[list[str]] | None = None,
    ) -> list[str]:
        """Batch cross-encoder wish mapping. Returns "null" when no match is confident."""
        if not items:
            return []

        prepared_wishes = list(wish_lists or [])
        # Pad / trim to match items length
        if len(prepared_wishes) < len(items):
            prepared_wishes.extend(
                [[] for _ in range(len(items) - len(prepared_wishes))]
            )
        else:
            prepared_wishes = prepared_wishes[: len(items)]

        try:
            ce = self._load_reranker()
            all_pairs: list[tuple[str, str]] = []
            group_sizes: list[int] = []

            for wished_item, wish_list in zip(items, prepared_wishes):
                normalized_wishes = [str(w) for w in wish_list]
                all_pairs.extend((wished_item, w) for w in normalized_wishes)
                all_pairs.append((wished_item, "null"))
                group_sizes.append(len(normalized_wishes) + 1)

            all_scores = ce.predict(all_pairs)

            results: list[str] = []
            offset = 0
            for size in group_sizes:
                block_scores = all_scores[offset : offset + size]
                block_pairs = all_pairs[offset : offset + size]
                results.append(block_pairs[int(np.argmax(block_scores))][1])
                offset += size

            return results

        except Exception as exc:
            log.warning("Wish mapping failed: %s", exc)
            return items.copy()
'''