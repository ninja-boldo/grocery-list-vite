from dataclasses import dataclass
from enum import Enum
from typing import List, Optional
from typing_extensions import Literal

from pydantic import BaseModel, Field


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: str | None = None


class User(BaseModel):
    username: str
    disabled: bool = False


class UserInDB(User):
    hashed_password: str


class ShortenLlmItemSingle(BaseModel):
    name: str
    categories: list[str]


class ShortenLlmInput(BaseModel):
    items: list[ShortenLlmItemSingle]


class GroceryItem(BaseModel):
    """Core item representation"""

    ean: str
    item_name: str
    subgroups: str = ""
    class_name: str = ""
    count: int = 1
    perish_dates: list[str] = []
    is_wish_list: bool = False
    imageUrl: str


class ItemUpdateRequest(BaseModel):
    """Request model for item updates"""

    ean: Optional[str] = None
    item_name: Optional[str] = None
    subgroups: Optional[str] = None
    count: Optional[int] = 1
    is_wish_list: Optional[bool] = False


class AddSupermarketRequest(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    category: Optional[str] = None
    postcode: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ItemInfo(BaseModel):
    product_name: str
    quantity: Optional[str] = None
    product_quantity: Optional[int] = None
    product_quantity_unit: Optional[str] = None


class QuantityInfo(BaseModel):
    product_quantity: Optional[int]
    product_quantity_unit: Optional[str]


class AddEanRequest(BaseModel):
    """Request model for add_ean_to_list endpoint"""

    ean: Optional[str] = None
    item_name: Optional[str] = None
    count: Optional[int] = 1
    wish_list: Optional[str] = None
    quantity_data: Optional[QuantityInfo] = None



class ItemInfoParsed(BaseModel):
    product_name: str
    quantity: QuantityInfo
    failedData: Optional[bool]


class UnitRetrieveItem(BaseModel):
    item_name: str
    categories: Optional[str] = None


@dataclass
class ClassificationResult:
    item: str
    cls: Optional[str]  # None if below threshold
    score: float
    below_threshold: bool
    top3: list[tuple[str, float]]  # always populated regardless of threshold


class Offer(BaseModel):
    name: str = Field(description="The full product name exactly as shown in catalogue")
    shortened_name: str = Field(
        description="Condensed name with brand, type, and specifications (weight/volume/count)"
    )
    weight_g: Optional[int] = Field(
        default=None,
        description="Net weight in grams as integer; null if the product is measured by volume or has no quantity",
    )
    volume_ml: Optional[int] = Field(
        default=None,
        description="Net volume in milliliters as integer; null if the product is measured by weight or has no quantity",
    )
    normal_price: float = Field(description="Regular price without discount")
    discount_price: float = Field(description="Price after discount applied")
    discount_rate: float = Field(
        description="Discount rate as decimal (e.g., 0.32 for 32% off)"
    )
    is_app_offer: bool = Field(
        description="True if offer requires app, false otherwise"
    )


class CatalogueResponse(BaseModel):
    offers: List[Offer] = Field(
        description="List of all offers extracted from the catalogue"
    )


class AddCatalogueRequest(BaseModel):
    """Request model for post_catlogue"""

    longitude: Optional[float] = None
    latitude: Optional[float] = None
    name: Optional[str] = None
    address: Optional[str] = None
    categories: Optional[str] = None
    city: Optional[str] = None
    postcode: Optional[str] = None


class Ingredient(BaseModel):
    amount: Optional[int] = None
    unit: Optional[str] = None
    name: str
    count: Optional[int] = None


class DayType(str, Enum):
    quick = "quick"
    normal = "normal"
    relaxed = "relaxed"


class Day(str, Enum):
    mo = "monday"
    tu = "tuesday"
    we = "wednesday"
    th = "thursday"  # typo fix
    fr = "friday"
    sa = "saturday"
    su = "sunday"


class DaySettings(BaseModel):
    day: str
    day_meal_time_type: DayType = DayType.normal
    breakfast_blocked: bool = False
    lunch_blocked: bool = False
    dinner_blocked: bool = False


class PlannerSettings(BaseModel):
    defaultServings: int
    quickMealMinutes: int
    normalMealMinutes: int


class Item(BaseModel):
    item_name: str
    item_id: str
    count: int
    quantity: QuantityInfo
    # info: Optional[str] = ""


class ItemsFetched(BaseModel):
    ean: str
    text: str
    shortened_name: str
    count: int
    perish_dates: list[str]
    imageUrl: str
    tags: str
    mappedItems: list
    quantity: QuantityInfo | None = None


class FetchItemsResponse(BaseModel):
    status: Literal[200]
    items: list[ItemsFetched]
    distinct_items: int
    accumulated_count: int


class InternalClassification(BaseModel):
    pantryItem: Item
    mappedWishItem: Item | None
    foundMappingWish: bool


class ClassificationWishListVsPantryInternal(BaseModel):
    mappings: list[InternalClassification]
    # info: Optional[str] = None


class SingleItemClassification(BaseModel):
    item: str
    category: Literal[
        "fruit vegetables",
        "dairy eggs",
        "bread bakery pastries",
        "snacks chips nuts",
        "meat poultry fish seafood",
        "grains rice pasta legumes",
        "canned preserved foods",
        "sauces spreads dips",
        "oils vinegars dressings",
        "spices herbs seasoning",
        "baking ingredients",
        "drinks beverages",
        "personal care hygiene",
        "household cleaning",
        "frozen foods",
        "other",
    ]


class ItemClassificationRes(BaseModel):
    items: list[SingleItemClassification]


class ItemsWishedForRecipe(BaseModel):
    items: list[Item]


class MappedWish(BaseModel):
    item: str
    mapped_wish: str
    index_wish_list: int


class WishMappingRes(BaseModel):
    items: list[MappedWish]


class ShortenedItem(BaseModel):
    original_name: str
    shortened_name: str


class ShortenNamesRes(BaseModel):
    items: list[ShortenedItem]


class WeekSettings(BaseModel):
    mo: DaySettings = DaySettings(day="monday")
    tu: DaySettings = DaySettings(day="tuesday")
    we: DaySettings = DaySettings(day="wednesday")
    th: DaySettings = DaySettings(day="thursday")
    fr: DaySettings = DaySettings(day="friday")
    sa: DaySettings = DaySettings(day="saturday")
    su: DaySettings = DaySettings(day="sunday")


class MealSlot(BaseModel):
    recipe_id: int
    servings: int
    meal_type: str
    day: str
    day_time: str


class DayPlan(BaseModel):
    breakfast: MealSlot | None = None
    lunch: MealSlot | None = None
    dinner: MealSlot | None = None


class WeekPlan(BaseModel):
    mo: DayPlan = DayPlan()
    tu: DayPlan = DayPlan()
    we: DayPlan = DayPlan()
    th: DayPlan = DayPlan()
    fr: DayPlan = DayPlan()
    sa: DayPlan = DayPlan()
    su: DayPlan = DayPlan()


class AddWeekPlan(BaseModel):
    week: WeekPlan
    DaySettings: WeekSettings


class DayBlockInfo(BaseModel):
    breakfast_blocked: bool = False
    lunch_blocked: bool = False
    dinner_blocked: bool = False


class Recipe(BaseModel):
    recipe_id: int
    name: Optional[str] = None
    base_time: Optional[int] = None
    default_portions: Optional[int] = None
    tags: Optional[list[str]] = None
    ingredients: list[Ingredient] = []
    emoji: Optional[str] = None


class AddRecipe(BaseModel):
    name: str
    emoji: str
    baseTime: int
    baseServings: Optional[int] = 2
    tags: Optional[list[str]] = []
    favorited: Optional[bool] = False
    ingredients: list[Ingredient]
    steps: list[str]

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class FetchedSingleItem(BaseModel):
    userId: str
    ean: str
    item_name: str | None = None
    per_date_count: list[int]
    perish_dates: list[str]
    isWished: str


class AddFetchedItems(BaseModel):
    items: list[FetchedSingleItem]


class ItemUpdateResponse(BaseModel):
    """Response model for item updates"""

    ean: str
    product_name: str
    subgroups: str = ""
    operation: str  # 'created', 'updated', 'deleted', 'created_new'
    execution_time: Optional[float] = None


class ItemListResponse(BaseModel):
    """Response model for item list"""

    items: list[GroceryItem]
    total: int


class MetadataResponse(BaseModel):
    """Response model for metadata"""

    subgroups: list[str]
    classnames: list[str]


class BatchUpdateItem(BaseModel):
    """Single item in batch update"""

    item_name: str
    count_delta: int


class BatchUpdateRequest(BaseModel):
    """Request model for batch updates"""

    items: list[BatchUpdateItem]


class BatchUpdateResponse(BaseModel):
    """Response model for batch updates"""

    updated: int
    failed: int
    errors: list[str]
