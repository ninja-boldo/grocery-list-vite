/**
 * Centralized API client for grocery list application
 * Provides consistent error handling, request formatting, and response parsing
 */

import type {
  GroceryItem,
  ItemUpdateRequest,
  ItemUpdateResponse,
  ItemFetchRequest,
  ItemListResponse,
  MetadataResponse,
  BatchUpdateResponse,
  ItemBatchUpdateRequest,
  LegacyItemTuple,
} from '../types/api';

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_BASE_URL = '/api';
const DEFAULT_TIMEOUT = 30000;

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class ApiError extends Error {
  statusCode?: number;
  originalError?: unknown;

  constructor(
    message: string,
    statusCode?: number,
    originalError?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
  }
}

// ============================================================================
// HTTP CLIENT
// ============================================================================

interface FetchOptions extends RequestInit {
  timeout?: number;
}

async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('Request timeout', 408, error);
    }
    throw error;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.detail || errorData.error || errorMessage;
    } catch {
      // Use default error message if JSON parsing fails
    }
    throw new ApiError(errorMessage, response.status);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new ApiError('Failed to parse response', response.status, error);
  }
}

// ============================================================================
// ITEM OPERATIONS (New RESTful API)
// ============================================================================

/**
 * Fetch items with optional filters
 */
export async function fetchItems(
  filters: ItemFetchRequest = {}
): Promise<GroceryItem[]> {
  const params = new URLSearchParams();
  if (filters.subgroups) params.set('subgroups', filters.subgroups);
  if (filters.classnames) params.set('classnames', filters.classnames);
  if (filters.onlyWishList !== undefined) {
    params.set('only_wish_list', String(filters.onlyWishList));
  }

  const url = `${API_BASE_URL}/items${params.toString() ? `?${params}` : ''}`;
  const response = await fetchWithTimeout(url);
  const data = await handleResponse<ItemListResponse>(response);

  return data.items;
}

/**
 * Update an item (create, modify count, or delete)
 */
export async function updateItem(
  request: ItemUpdateRequest
): Promise<ItemUpdateResponse> {
  const params = new URLSearchParams();
  if (request.ean) params.set('ean', request.ean);
  if (request.itemName) params.set('item_name', request.itemName);
  if (request.subgroups) params.set('subgroups', request.subgroups);
  if (request.count !== undefined) params.set('count', String(request.count));
  if (request.isWishList !== undefined) {
    params.set('is_wish_list', String(request.isWishList));
  }

  const url = `${API_BASE_URL}/items/update?${params}`;
  const response = await fetchWithTimeout(url);
  return handleResponse<ItemUpdateResponse>(response);
}

/**
 * Batch update multiple items
 */
export async function batchUpdateItems(
  request: ItemBatchUpdateRequest
): Promise<BatchUpdateResponse> {
  const url = `${API_BASE_URL}/items/batch`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse<BatchUpdateResponse>(response);
}

/**
 * Delete an item by name
 */
export async function deleteItem(itemName: string): Promise<void> {
  const url = `${API_BASE_URL}/items/${encodeURIComponent(itemName)}`;
  const response = await fetchWithTimeout(url, { method: 'DELETE' });
  await handleResponse<void>(response);
}

// ============================================================================
// METADATA OPERATIONS
// ============================================================================

/**
 * Fetch all metadata (subgroups and classnames) in a single request
 */
export async function fetchMetadata(): Promise<MetadataResponse> {
  const url = `${API_BASE_URL}/metadata`;
  const response = await fetchWithTimeout(url);
  return handleResponse<MetadataResponse>(response);
}

/**
 * Fetch only subgroups
 */
export async function fetchSubgroups(): Promise<string[]> {
  const url = `${API_BASE_URL}/metadata/subgroups`;
  const response = await fetchWithTimeout(url);
  const data = await handleResponse<{ subgroups: string[] }>(response);
  return data.subgroups;
}

/**
 * Fetch only classnames
 */
export async function fetchClassnames(): Promise<string[]> {
  const url = `${API_BASE_URL}/metadata/classnames`;
  const response = await fetchWithTimeout(url);
  const data = await handleResponse<{ classnames: string[] }>(response);
  return data.classnames;
}

// ============================================================================
// LEGACY API (Backwards compatibility)
// ============================================================================

/**
 * @deprecated Use fetchItems instead
 * Legacy fetch_items endpoint
 */
export async function fetchItemsLegacy(
  subgroups?: string,
  classnames?: string,
  onlyWishList?: string
): Promise<LegacyItemTuple[]> {
  const params = new URLSearchParams();
  if (subgroups) params.set('subgroups', subgroups);
  if (classnames) params.set('classnames', classnames);
  if (onlyWishList) params.set('only_wish_list', onlyWishList);

  const url = `${API_BASE_URL}/fetch_items${params.toString() ? `?${params}` : ''}`;
  const response = await fetchWithTimeout(url);
  const data = await handleResponse<{ item_list: LegacyItemTuple[] }>(response);

  return data.item_list;
}

/**
 * @deprecated Use updateItem instead
 * Legacy add_ean_to_list_manual endpoint
 */
export async function addEanManualLegacy(
  ean?: string,
  itemName?: string,
  subgroups?: string,
  count?: number,
  isWishList?: boolean
): Promise<ItemUpdateResponse> {
  const params = new URLSearchParams();
  if (ean) params.set('ean', ean);
  if (itemName) params.set('item_name', itemName);
  if (subgroups) params.set('subgroups', subgroups);
  if (count !== undefined) params.set('count', String(count));
  if (isWishList !== undefined) params.set('is_wish_list', String(isWishList));

  const url = `${API_BASE_URL}/add_ean_to_list_manual/?${params}`;
  const response = await fetchWithTimeout(url);
  return handleResponse<ItemUpdateResponse>(response);
}

/**
 * @deprecated Use updateItem instead
 * Legacy add_ean_to_list endpoint
 */
export async function addEanLegacy(
  ean?: string,
  itemName?: string,
  subgroups?: string,
  count?: number,
  wishList?: boolean
): Promise<ItemUpdateResponse> {
  const params = new URLSearchParams();
  if (ean) params.set('ean', ean);
  if (itemName) params.set('item_name', itemName);
  if (subgroups) params.set('subgroups', subgroups);
  if (count !== undefined) params.set('count', String(count));
  if (wishList !== undefined) params.set('wish_list', String(wishList));

  const url = `${API_BASE_URL}/add_ean_to_list/?${params}`;
  const response = await fetchWithTimeout(url);
  return handleResponse<ItemUpdateResponse>(response);
}

// ============================================================================
// HELPER UTILITIES
// ============================================================================

/**
 * Convert legacy tuple format to GroceryItem
 */
export function convertLegacyToItem(tuple: LegacyItemTuple): GroceryItem {
  const [ean, itemName, subgroups, className, count, timestamps] = tuple;
  
  let perishDates: string[] = [];
  try {
    perishDates = JSON.parse(timestamps || '[]');
  } catch {
    perishDates = [];
  }

  return {
    ean,
    itemName,
    subgroups,
    className,
    count,
    perishDates,
    isWishList: false, // Legacy format doesn't include this
  };
}

/**
 * Convert GroceryItem to legacy tuple format
 */
export function convertItemToLegacy(item: GroceryItem): LegacyItemTuple {
  return [
    item.ean,
    item.itemName,
    item.subgroups,
    item.className,
    item.count,
    JSON.stringify(item.perishDates),
  ];
}

/**
 * Increment item count by 1
 */
export async function incrementItem(itemName: string, isWishList: boolean = false): Promise<ItemUpdateResponse> {
  return updateItem({ itemName, count: 1, isWishList });
}

/**
 * Decrement item count by 1
 */
export async function decrementItem(itemName: string, isWishList: boolean = false): Promise<ItemUpdateResponse> {
  return updateItem({ itemName, count: -1, isWishList });
}
