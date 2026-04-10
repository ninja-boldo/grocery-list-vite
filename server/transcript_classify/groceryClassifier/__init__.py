from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .groceryClassifierCustom import GroceryClassifier
    from .groceryClassifierLlm import GroceryClassifierLlm


def __getattr__(name: str):
    if name == "GroceryClassifier":
        from .groceryClassifierCustom import GroceryClassifier

        return GroceryClassifier
    if name == "GroceryClassifierLlm":
        from .groceryClassifierLlm import GroceryClassifierLlm

        return GroceryClassifierLlm
    raise AttributeError(name)


__all__ = ["GroceryClassifier", "GroceryClassifierLlm"]
