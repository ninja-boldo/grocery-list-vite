import '../App.css';
import Container from './../comp/other/Container';
import { useCallback, useEffect, useState, useMemo } from 'react';
import ErrorContainer from './../comp/utils/ErrorContainer';
import { useNavigate } from 'react-router-dom';
import type { ApiResponse } from "../lib/utils";
import { transformItems } from '@/lib/utils';
import InfoContainer from '../comp/utils/InfoContainer';
import type { Item } from '../App';
import TopBar from '@/comp/other/TopBar';
import Sidebar from '@/comp/other/Sidebar';
import  { PageModes } from '../lib/utils'
 

// ============================================================================
// CONSTANTS
// ============================================================================

const API_CONFIG = {
  retries: 3,
  baseDelay: 1000,
  timeout: 10000,
} as const;

// ============================================================================
// SELF-HEALING API UTILITIES
// ============================================================================
async function apiCall<T>(
  url: string,
  options: RequestInit = {},
  retries = API_CONFIG.retries
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, API_CONFIG.baseDelay * (attempt + 1)));
      }
    }
  }
  throw lastError ?? new Error('API call failed');
}

// ============================================================================
// COMPONENT
// ============================================================================
function WishList() {
  const navigate = useNavigate();

  // State
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Item[]>(transformItems({ "items": [
          { "ean": "loading-0", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""}
        ]}));
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Navigation
  const navigateScanner = useCallback(
    (item: Item | null, count: number = 1) => {
      const params = new URLSearchParams({ wishlist: 'true', count: String(count) });
      if (item?.subgroups) params.set('subgroups', item.subgroups);
      else params.set('text', '');
      navigate(`/scanner?${params}`);
    },
    [navigate]
  );


  // Item count handlers with optimistic updates
  const increaseItemCount = useCallback(async (item: Item) => {
    if (!item.text) return;

    // Optimistic update
    setData((prev) =>
      prev.map((i) => (i.text === item.text ? { ...i, count: i.count + 1 } : i))
    );

    
    let success: boolean = true
    fetch("/api/add_ean_to_list/", {
      method: "POST",
      body: JSON.stringify({
        item_name: item.text,
        count: 1,
        subgroups: item.subgroups || '',
        wish_list: "true"
      }),
      headers: {
        "Content-type": "application/json; charset=UTF-8"
      }
    }).catch(err => {
      console.error('Error sending item:', err);
      success = false
    });

    // Rollback on failure
    if (!success) {
      setData((prev) =>
        prev.map((i) => (i.text === item.text ? { ...i, count: i.count - 1 } : i))
      );
      setError('Failed to update item count');
    }
  }, []);

  const decreaseItemCount = useCallback(async (item: Item) => {
    if (!item.text) return;

    const willDelete = item.count <= 1;

    // Optimistic update
    setData((prev) =>
      willDelete
        ? prev.filter((i) => i.text !== item.text)
        : prev.map((i) => (i.text === item.text ? { ...i, count: i.count - 1 } : i))
    );

    fetch("/api/add_ean_to_list/", {
      method: "POST",
      body: JSON.stringify({
        item_name: item.text,
        count: -1,
        subgroups: item.subgroups || '',
        wish_list: "true"
      }),
      headers: {
        "Content-type": "application/json; charset=UTF-8"
      }
    }).catch(err => {
      console.error('Error sending item:', err);
    });

  }, []);

  // Data fetching with self-healing
  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiCall<ApiResponse>('/api/fetch_items?only_wish_list=true');
      const items: Item[] = response.items.map((item) => ({
        ean: item.ean,
        text: item.text,
        subgroups: item.subgroups,
        style: '',
        classname: item.classname,
        count: item.count,
        perish_dates: item.perish_dates,
        imageUrl: item.imageUrl,
        onClickIncrease: increaseItemCount,
        onClickDecrease: decreaseItemCount,
        tags: null,
      }));

      setData(items);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch wish list';
      setError(message);
      console.error('WishList fetch failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [increaseItemCount, decreaseItemCount]);

  // Memoized container list
  const containerComponents = useMemo(
    () =>
      data.map((item, idx) => (
        <Container
          key={`${item.text}-${idx}`}
          ean={item.ean}
          text={item.text}
          subgroups={item.subgroups}
          count={item.count}
          classname={item.classname}
          perish_dates={['none']}
          imageUrl={item.imageUrl}
          onClickIncrease={increaseItemCount}
          onClickDecrease={decreaseItemCount}
          tags={null}
          style=""
        />
      )),
    [data, increaseItemCount, decreaseItemCount]
  );

  // Initial data load
  useEffect(() => {
    fetchItems();
  }, [fetchItems]);



  // Loading state
  if (isLoading && data.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-cyan-400 text-lg">Loading...</div>
      </div>
    );
  }

  /*
  const fetchItemsWithParams = async (setItems: (items: Item[]) => void) => {
    setError(null);

    try {
      const params = new URLSearchParams({ only_wish_list: "true" });

      const url = `/api/fetch_items?${params}`;
      console.log("Calling API with URL:", url);

      const response = await apiCall<ApiResponse>(url);
      console.log("API returned items:", response.items.length);

      const newItems = transformItems(response);
      setItems(newItems);
    } catch {
      console.error("something has gone wrong while fetching");
    }
  };
*/

  const noItemsAvailable = data.length === 0 && !error;

  return (
    <>
      <Sidebar isOpen={sidebarOpen} onClose={() => (null)} />
      <div className="flex flex-col min-h-screen">
        {error ? (
          <ErrorContainer text={error} />
        ) : (
          <>
            <TopBar
              sidebarOpen={sidebarOpen}
              onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
              subgroups={[]}
              onFilter={null}
              onReset={fetchItems}
              onScanIncrease={() => navigateScanner(null, 1)}
              onScanDecrease={() => navigateScanner(null, -1)}
              items={data}
              setItems={setData}
              mode={PageModes.WishPage}
            />

            {/* Main Content */}
            <main className="flex-1 p-3 sm:p-4 md:p-6">
              <div className="max-w-4xl mx-auto">
                {noItemsAvailable ? (
                  <InfoContainer text={"No items on your wish list.\nAdd something you'd like to buy!"} />
                ) : (
                  containerComponents
                )}
              </div>
            </main>
          </>
        )}
      </div>
    </>
  );
}

export default WishList;