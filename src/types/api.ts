/**
 * Shared API types for grocery list application
 * These types ensure consistency between frontend and backend communication
 */

// ============================================================================
// DOMAIN MODELS
// ============================================================================

/**
 * Core item representation with all properties
 */
export interface GroceryItem {
  ean: string;
  itemName: string;
  subgroups: string;
  className: string;
  count: number;
  perishDates: string[];
  isWishList: boolean;
}

/**
 * Simplified item for display purposes
 */
export interface ItemDisplay {
  text: string | null;
  subgroups: string | null;
  count: number;
  classname: string | null;
  perish_dates: string[] | null;
}

/**
 * Item metadata (categories and classifications)
 */
export interface ItemMetadata {
  subgroups: string[];
  classnames: string[];
}

// ============================================================================
// API REQUEST TYPES
// ============================================================================

/**
 * Request to add/update an item
 */
export interface ItemUpdateRequest {
  ean?: string;
  itemName?: string;
  subgroups?: string;
  count?: number;
  isWishList?: boolean;
}

/**
 * Request to fetch items with filters
 */
export interface ItemFetchRequest {
  subgroups?: string;
  classnames?: string;
  onlyWishList?: boolean;
}

/**
 * Batch update request for multiple items
 */
export interface ItemBatchUpdateRequest {
  items: Array<{
    item_name: string;
    count_delta: number;
  }>;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

/**
 * Response from item fetch endpoint
 */
export interface ItemListResponse {
  items: GroceryItem[];
  total: number;
}

/**
 * Response from item update endpoint
 */
export interface ItemUpdateResponse {
  ean: string;
  productName: string;
  subgroups: string;
  operation: 'created' | 'updated' | 'deleted' | 'created_new';
  executionTime?: number;
}

/**
 * Response from metadata fetch endpoint
 */
export interface MetadataResponse {
  subgroups: string[];
  classnames: string[];
}

/**
 * Response from batch update endpoint
 */
export interface BatchUpdateResponse {
  updated: number;
  failed: number;
  errors: string[];
}

// ============================================================================
// LEGACY TYPES (for backwards compatibility)
// ============================================================================

/**
 * @deprecated Use GroceryItem instead
 * Legacy item list tuple format: [ean, item_name, subgroups, class, count, timestamps]
 */
export type LegacyItemTuple = [string, string, string, string, number, string];

/**
 * @deprecated Use ItemListResponse instead
 */
export interface LegacyItemListResponse {
  item_list: LegacyItemTuple[];
}

/**
 * @deprecated Use MetadataResponse instead
 */
export interface LegacyMetadataResponse {
  subgroups?: string[];
  classnames?: string[];
}
