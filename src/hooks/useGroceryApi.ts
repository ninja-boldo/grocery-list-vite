/**
 * React hooks for grocery list API operations
 * Provides easy-to-use hooks with built-in error handling and state management
 */

import { useState, useCallback } from 'react';
import type { GroceryItem, ItemUpdateRequest, MetadataResponse } from '../types/api';
import * as apiClient from '../utils/api-client';

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

/**
 * Hook for fetching and managing items
 */
export function useItems() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async (filters?: {
    subgroups?: string;
    classnames?: string;
    onlyWishList?: boolean;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const fetchedItems = await apiClient.fetchItems(filters || {});
      setItems(fetchedItems);
      return fetchedItems;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch items';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateItem = useCallback(async (request: ItemUpdateRequest) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.updateItem(request);
      // Refresh items after update
      await fetchItems();
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update item';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchItems]);

  const incrementItem = useCallback(async (itemName: string, isWishList = false) => {
    // Optimistic update
    setItems(prev =>
      prev.map(item =>
        item.itemName === itemName ? { ...item, count: item.count + 1 } : item
      )
    );

    try {
      return await apiClient.incrementItem(itemName, isWishList);
    } catch (err) {
      // Rollback on error
      await fetchItems();
      throw err;
    }
  }, [fetchItems]);

  const decrementItem = useCallback(async (itemName: string, isWishList = false) => {
    // Optimistic update
    setItems(prev =>
      prev.map(item =>
        item.itemName === itemName ? { ...item, count: Math.max(0, item.count - 1) } : item
      )
    );

    try {
      return await apiClient.decrementItem(itemName, isWishList);
    } catch (err) {
      // Rollback on error
      await fetchItems();
      throw err;
    }
  }, [fetchItems]);

  return {
    items,
    loading,
    error,
    fetchItems,
    updateItem,
    incrementItem,
    decrementItem,
  };
}

/**
 * Hook for fetching metadata
 */
export function useMetadata() {
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetadata = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.fetchMetadata();
      setMetadata(data);
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch metadata';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    metadata,
    loading,
    error,
    fetchMetadata,
  };
}

/**
 * Hook for batch operations
 */
export function useBatchUpdate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batchUpdate = useCallback(async (items: Array<{ itemName: string; countDelta: number }>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.batchUpdateItems({
        items: items.map(item => ({
          item_name: item.itemName,
          count_delta: item.countDelta,
        })),
      });
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Batch update failed';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    batchUpdate,
  };
}
