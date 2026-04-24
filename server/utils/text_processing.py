import re

from utils.lookup import CANONICAL_COMPOUNDS, PHRASE_STRIP, TYPO_CORRECTIONS, WORD_STRIP


def normalizeSeparators(text: str) -> str:
    text = re.sub(r"[-_/\u00b7,]+", " ", text)
    text = re.sub(r"\s*\([^)]*\)\s*", " ", text)
    return text.strip()


def shortenWithTable(itemName: str) -> str:
    itemName = normalizeSeparators(itemName).strip().lower()

    for phrase in sorted(PHRASE_STRIP, key=len, reverse=True):
        pattern = r"\b" + re.escape(phrase) + r"\b"
        itemName = re.sub(pattern, " ", itemName)

    for compound, replacement in sorted(
        CANONICAL_COMPOUNDS.items(), key=lambda x: len(x[0]), reverse=True
    ):
        pattern = r"\b" + re.escape(compound) + r"\b"
        itemName = re.sub(pattern, replacement, itemName)

    for typo, correction in sorted(
        TYPO_CORRECTIONS.items(), key=lambda x: len(x[0]), reverse=True
    ):
        pattern = r"\b" + re.escape(typo) + r"\b"
        itemName = re.sub(pattern, correction, itemName)

    itemName = re.sub(r"\s+", " ", itemName).strip()

    if not itemName:
        return ""

    tokens = []
    for word in itemName.split():
        word = word.strip("()\"'")
        if word in WORD_STRIP:
            replacement = WORD_STRIP[word]
            if replacement:
                tokens.append(replacement)
        elif word:
            tokens.append(word)

    return " ".join(tokens).strip()
