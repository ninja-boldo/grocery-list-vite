from typing import Optional

from pydantic import BaseModel


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
