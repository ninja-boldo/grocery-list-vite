from typing import List, Optional

from pydantic import BaseModel, Field


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


class AddEanRequest(BaseModel):
    """Request model for add_ean_to_list endpoint (legacy)"""

    ean: Optional[str] = None
    item_name: Optional[str] = None
    count: Optional[int] = 1
    wish_list: Optional[str] = None


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
