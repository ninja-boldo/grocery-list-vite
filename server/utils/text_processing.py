import re

from utils.lookup import PHRASE_STRIP, WORD_STRIP


def normalizeSeparators(text: str) -> str:
    return re.sub("[_\\-/\u00b7,]+", " ", text)


def shortenWithTable(itemName: str) -> str:
    itemName = normalizeSeparators(itemName.lower()).strip()

    for phrase in sorted(PHRASE_STRIP, key=len, reverse=True):
        itemName = itemName.replace(phrase, " ")

    tokens = []
    for word in itemName.split():
        tokens.append(WORD_STRIP.get(word, word))

    return " ".join(tokens).strip()
