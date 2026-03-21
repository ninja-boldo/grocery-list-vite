import '../App.css';
import Container, { type ContainerProps } from './../comp/other/Container';
import { useCallback, useEffect, useState, useMemo } from 'react';
import ErrorContainer from './../comp/utils/ErrorContainer';
import { useNavigate } from 'react-router-dom';
import type { ApiResponse } from "../lib/utils";
import { transformItems } from '@/lib/utils';
import { authApiCall, hasStoredJwtToken } from '@/lib/authApi';
import InfoContainer from '../comp/utils/InfoContainer';
import type { Item } from '../App';
import TopBar from '@/comp/other/TopBar';
import Sidebar from '@/comp/other/Sidebar';
import AuthPopup from '@/comp/other/AuthPopup';
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
// COMPONENT
// ============================================================================
function WishList() {
  const navigate = useNavigate();

  // State
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [needReauth, setNeedReauth] = useState(false);

  useEffect(() => {
    if (!hasStoredJwtToken()) {
      setNeedReauth(true);
    }
  }, []);

  const handleNeedReauth = useCallback(() => {
    setNeedReauth(true);
    setError('Authentication required. Please sign in again.');
  }, []);

  const apiCall = useCallback(async <T,>(
    url: string,
    options: RequestInit = {},
    retries: number = API_CONFIG.retries,
    onUnauthorized?: () => void,
  ): Promise<T> =>
    authApiCall<T>(url, options, {
      retries,
      retryDelayMs: API_CONFIG.baseDelay,
      timeoutMs: API_CONFIG.timeout,
      onUnauthorized,
    }),
  []);

  // Navigation
  const navigateScanner = useCallback(
    (count: number = 1) => {
      const params = new URLSearchParams({ wishlist: 'true', count: String(count), text: '' });
      navigate(`/scanner?${params}`);
    },
    [navigate]
  );


  // Item count handlers with optimistic updates
  const increaseItemCount = useCallback(async (item: ContainerProps) => {
    if (!item.text) return;

    let previousData: Item[] = [];

    // Optimistic update
    setData((prev) => {
      previousData = prev;
      return prev.map((i) =>
        i.ean === item.ean && i.text === item.text ? { ...i, count: i.count + 1 } : i,
      );
    });

    try {
      await apiCall(
        '/api/add_ean_to_list/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({
            ean: item.ean,
            item_name: item.text,
            count: 1,
            wish_list: 'true',
          }),
        },
        1,
        handleNeedReauth,
      );
    } catch (err) {
      setData(previousData);
      setError('Failed to update item count');
      console.error('Error sending item:', err);
    }
  }, [apiCall, handleNeedReauth]);

  const decreaseItemCount = useCallback(async (item: ContainerProps) => {
    if (!item.text) return;

    const willDelete = item.count <= 1;
    let previousData: Item[] = [];

    // Optimistic update
    setData((prev) => {
      previousData = prev;
      if (willDelete) {
        return prev.filter((i) => !(i.ean === item.ean && i.text === item.text));
      }
      return prev.map((i) =>
        i.ean === item.ean && i.text === item.text ? { ...i, count: i.count - 1 } : i,
      );
    });

    try {
      await apiCall(
        '/api/add_ean_to_list/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({
            ean: item.ean,
            item_name: item.text,
            count: -1,
            wish_list: 'true',
          }),
        },
        1,
        handleNeedReauth,
      );
    } catch (err) {
      setData(previousData);
      setError('Failed to update item count');
      console.error('Error sending item:', err);
    }
  }, [apiCall, handleNeedReauth]);

  // Data fetching with self-healing
  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiCall<ApiResponse>(
        '/api/fetch_items?only_wish_list=true',
        undefined,
        API_CONFIG.retries,
        handleNeedReauth,
      );
      setData(transformItems(response));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch wish list';
      setError(message);
      console.error('WishList fetch failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [apiCall, handleNeedReauth]);

  // Memoized container list
  const containerComponents = useMemo(
    () =>
      data.map((item, idx) => (
        <Container
          key={`${item.text}-${idx}`}
          ean={item.ean}
          text={item.text}
          shortened_name={item.shortened_name}
          count={item.count}
          classname={item.classname}
          perish_dates={item.perish_dates}
          imageUrl={item.imageUrl}
          onClickIncrease={increaseItemCount}
          onClickDecrease={decreaseItemCount}
          tags={item.tags}
          isWishedNumber={item.count}
          style=""
        />
      )),
    [data, increaseItemCount, decreaseItemCount]
  );

  // Initial data load
  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);



  // Loading state
  if (isLoading && data.length === 0 && !needReauth) {
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

  const displayError = (() => {
    if (!error) return null;

    const normalized = error.toLowerCase();
    const excludedFragments = [
      'http 401',
      'authentication required. please sign in again.',
    ];

    const isExcluded = excludedFragments.some((fragment) =>
      normalized.includes(fragment),
    );

    return isExcluded ? null : error;
  })();

  const noItemsAvailable = data.length === 0 && !error && !isLoading;

  return (
    <div className='h-screen'>
      {needReauth && (
        <AuthPopup
          onAuthenticated={() => {
            setNeedReauth(false);
            setError(null);
            void fetchItems();
          }}
        />
      )}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} setNeedReauth={setNeedReauth} />
      {displayError ? (
        <ErrorContainer text={displayError} />
      ) : (
        <div className='h-screen'>
          <TopBar
            sidebarOpen={sidebarOpen}
            onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
            classNames={[]}
            selectedClass={null}
            onFilter={() => undefined}
            onReset={() => {
              void fetchItems();
            }}
            onScanIncrease={() => navigateScanner(1)}
            onScanDecrease={() => navigateScanner(-1)}
            items={data}
            setItems={setData}
            currentSortOrder="new-old"
            mode={PageModes.WishPage}
          />

          {/* Main Content */}
          <div className="flex-1 p-3 sm:p-4 md:p-6">
            <div className="max-w-4xl mx-auto">
              {noItemsAvailable ? (
                <InfoContainer text={"No items on your wish list.\nAdd something you'd like to buy!"} />
              ) : (
                containerComponents
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WishList;