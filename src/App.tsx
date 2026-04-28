import "./App.css";
import Container, { type ContainerProps } from "./comp/other/Container";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import ErrorContainer from "./comp/utils/ErrorContainer";
import { useNavigate } from "react-router-dom";
import InfoContainer from "./comp/utils/InfoContainer";
import { Virtuoso } from "react-virtuoso";
import TopBar from "./comp/other/TopBar";
import AppHeader from "./comp/other/AppHeader";
import BottomTabBar from "./comp/other/BottomTabBar";
import { transformItems, PageModes, type ApiResponse } from "./lib/utils";
import { authApiCall, hasStoredJwtToken } from "./lib/authApi";
import { apiClient } from "./lib/api/client";
import { isAddEanSuccess } from "./lib/api/addEanFlow";
import { buildFetchItemsUrl } from "./lib/api/openapi";
import AuthPopup from "./comp/other/AuthPopup";
import { useTranslation } from "react-i18next";

// ============================================================================
// Types
// ============================================================================
export interface Item {
  ean: string;
  text: string | null;
  shortened_name: string | null;
  classname: string | null;
  count: number;
  perish_dates: string[];
  imageUrl: string;
  tags: string[];
  /** Wish-list only: inventory items matched to this entry */
  mapped_items?: { count: number; item_name: string }[];
  /** Days until expiry, or -1 if unknown/unavailable */
  expiryDays?: number | null;
}

// ============================================================================
// Constants
// ============================================================================
const PLACEHOLDER_ITEM_COUNT = 15;
const RETRY_ATTEMPTS = 3;
const INITIAL_SORT_ORDER = "new-old";
const NEW_ITEMS_PER_FETCH = 20;

// ============================================================================
// Helpers
// ============================================================================
const buildPlaceholderItems = (): Item[] =>
  Array.from({ length: PLACEHOLDER_ITEM_COUNT }, (_, index) => ({
    ean: `loading-${index}`,
    text: "Loading...", // only visible for a short time -> no translation needed
    shortened_name: null,
    classname: null,
    count: 0,
    perish_dates: [],
    imageUrl: "",
    tags: [],
  }));

const isPlaceholderList = (items: Item[]) =>
  items.length > 0 && items[0].ean.startsWith("loading-");

const mergeWithDedup = (previous: Item[], incoming: Item[]): Item[] => {
  const seen = new Set<string>();
  return [...previous, ...incoming].filter((item) => {
    const key = `${item.ean}-${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

type GroceryItemsHookOptions = {
  setError: Dispatch<SetStateAction<string | null>>;
  isSearchActive: boolean;
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  needReauth: boolean;
  onNeedReauth: () => void;
};

type GroceryItemsHookResult = {
  data: Item[];
  setData: Dispatch<SetStateAction<Item[]>>;
  selectedClass: string | null;
  sortOrder: string;
  hasMoreData: boolean;
  noItemsAvailable: boolean;
  filterFetchItems: (
    classFilter: string | null,
    sortOrderFilter?: string,
  ) => Promise<void>;
  resetFilters: () => Promise<void>;
  loadMoreItems: () => void;
};

// ============================================================================
// Main Component
// ============================================================================
function App() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [needReauth, setNeedReauth] = useState(false);

  useEffect(() => {
    if (!hasStoredJwtToken()) {
      setNeedReauth(true);
    }

    const lang = "de";
    console.log("changed language to ", lang);
    i18n.changeLanguage(lang);
  }, []);

  const handleNeedReauth = useCallback(() => {
    setNeedReauth(true);
  }, []);

  const apiCall = useCallback(
    async <T,>(
      url: string,
      options?: RequestInit,
      retries = RETRY_ATTEMPTS,
      onUnauthorized?: () => void,
    ): Promise<T> =>
      authApiCall<T>(url, options, {
        retries,
        retryDelayMs: 1000,
        onUnauthorized,
      }),
    [],
  );

  function useGroceryItems({
    setError,
    isSearchActive,
    isLoading,
    setIsLoading,
    needReauth,
    onNeedReauth,
  }: GroceryItemsHookOptions): GroceryItemsHookResult {
    const [data, setData] = useState<Item[]>(buildPlaceholderItems());
    const [selectedClass, setSelectedClass] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<string>(INITIAL_SORT_ORDER);
    const [hasMoreData, setHasMoreData] = useState(true);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [noItemsAvailable, setNoItemsAvailable] = useState(false);

    const sortOrderRef = useRef(sortOrder);
    const skipRef = useRef(0);
    const isSearchActiveRef = useRef(isSearchActive);
    const isLoadingRef = useRef(isLoading);
    const hasRealDataRef = useRef(false);

    useEffect(() => {
      sortOrderRef.current = sortOrder;
    }, [sortOrder]);

    useEffect(() => {
      isSearchActiveRef.current = isSearchActive;
    }, [isSearchActive]);

    useEffect(() => {
      isLoadingRef.current = isLoading;
    }, [isLoading]);

    const resetPagination = useCallback(() => {
      skipRef.current = 0;
      hasRealDataRef.current = false;
      setHasMoreData(true);
      setNoItemsAvailable(false);
      setIsInitialLoad(true);
      setData(buildPlaceholderItems());
    }, [setData, setHasMoreData, setNoItemsAvailable, setIsInitialLoad]);

    const appendItems = useCallback(
      (incoming: Item[]) => {
        setData((prev) => {
          if (isPlaceholderList(prev)) {
            return incoming;
          }
          return mergeWithDedup(prev, incoming);
        });

        if (incoming.length > 0) {
          hasRealDataRef.current = true;
          setHasMoreData(true);
          setNoItemsAvailable(false);
        }
      },
      [setData, setHasMoreData, setNoItemsAvailable],
    );

    const handleEmptyResponse = useCallback(() => {
      setHasMoreData(false);
      if (skipRef.current === 0 && !hasRealDataRef.current) {
        setNoItemsAvailable(true);
        setData([]);
      }
    }, [setHasMoreData, setNoItemsAvailable, setData]);

    const fetchItemsWithParams = useCallback(
      async (sortOrderOverride?: string) => {
        if (needReauth || isLoadingRef.current || isSearchActiveRef.current) {
          return;
        }

        if (!hasStoredJwtToken()) {
          onNeedReauth();
          return;
        }

        setIsLoading(true);
        setError(null);

        const sortToUse = sortOrderOverride ?? sortOrderRef.current;
        const requestUrl = buildFetchItemsUrl({
          onlyWishList: false,
          sortOrder: sortToUse,
          skip: skipRef.current,
          limit: NEW_ITEMS_PER_FETCH,
          userId: "1",
        });

        try {
          const response = await apiCall<ApiResponse>(
            requestUrl,
            undefined,
            RETRY_ATTEMPTS,
            onNeedReauth,
          );
          if (!response.items.length) {
            handleEmptyResponse();
            return;
          }

          skipRef.current += response.items.length;
          appendItems(transformItems(response));
        } catch (err) {
          console.warn("failed in line 245");
          const errorMessage =
            err instanceof Error
              ? err.message
              : t("failedToFetchItems", "Failed to fetch items");
          setError(errorMessage);
        } finally {
          setIsLoading(false);
          setIsInitialLoad(false);
        }
      },
      [
        appendItems,
        handleEmptyResponse,
        needReauth,
        onNeedReauth,
        setError,
        setIsLoading,
      ],
    );

    const filterFetchItems = useCallback(
      async (classFilter: string | null, sortOrderFilter?: string) => {
        if (classFilter !== null) {
          setSelectedClass(classFilter);
        }

        if (!sortOrderFilter) {
          return;
        }

        setSortOrder(sortOrderFilter);
        resetPagination();
        await fetchItemsWithParams(sortOrderFilter);
      },
      [fetchItemsWithParams, resetPagination, setSelectedClass, setSortOrder],
    );

    const resetFilters = useCallback(async () => {
      setSelectedClass(null);
      setSortOrder(INITIAL_SORT_ORDER);
      resetPagination();
      await fetchItemsWithParams(INITIAL_SORT_ORDER);
    }, [fetchItemsWithParams, resetPagination, setSelectedClass, setSortOrder]);

    const loadMoreItems = useCallback(() => {
      if (
        !isInitialLoad &&
        hasMoreData &&
        !isLoadingRef.current &&
        !isSearchActiveRef.current
      ) {
        void fetchItemsWithParams();
      }
    }, [fetchItemsWithParams, hasMoreData, isInitialLoad]);

    useEffect(() => {
      void fetchItemsWithParams();
    }, [fetchItemsWithParams]);

    return {
      data,
      setData,
      selectedClass,
      sortOrder,
      hasMoreData,
      noItemsAvailable,
      filterFetchItems,
      resetFilters,
      loadMoreItems,
    };
  }

  const {
    data,
    setData,
    selectedClass,
    sortOrder,
    hasMoreData,
    noItemsAvailable,
    filterFetchItems,
    resetFilters,
    loadMoreItems,
  } = useGroceryItems({
    setError,
    isSearchActive,
    isLoading,
    setIsLoading,
    needReauth,
    onNeedReauth: handleNeedReauth,
  });

  useEffect(() => {
    if (needReauth) {
      setError("Authentication required. Please sign in again.");
    }
  }, [needReauth]);

  const availableClasses = useMemo(() => {
    const result = new Set<string>();
    data.forEach((item) => {
      if (item.ean.startsWith("loading-")) return;
      item.tags.forEach((tag) => {
        const cleaned = tag?.trim();
        if (cleaned) result.add(cleaned);
      });
    });
    return Array.from(result).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const visibleData = useMemo(() => {
    if (!selectedClass) return data;
    return data.filter(
      (item) =>
        item.ean.startsWith("loading-") ||
        item.tags.some((tag) => tag === selectedClass),
    );
  }, [data, selectedClass]);

  // Keep inventory count updates on the typed api client so auth + response
  // handling stays consistent with the OpenAPI-backed request layer.
  const updateItemCount = useCallback(
    async (item: ContainerProps, delta: number) => {
      if (!item.text) return;

      const newCount = item.count + delta;

      setData((prev) =>
        prev.map((i) =>
          i.text === item.text ? { ...i, count: Math.max(0, newCount) } : i,
        ),
      );

      try {
        const response = await apiClient.addEanToList(
          {
            ean: item.ean,
            item_name: item.text,
            count: delta,
            wish_list: "false",
            quantity_data: null,
          },
          {
            retries: 1,
            retryDelayMs: 300,
            onUnauthorized: handleNeedReauth,
          },
        );

        if (!isAddEanSuccess(response)) {
          throw new Error("Server rejected add item request");
        }

        if (newCount <= 0) {
          setTimeout(() => window.location.reload(), 100);
        }
      } catch (err) {
        setError("Failed to update item");
        setData((prev) =>
          prev.map((i) =>
            i.text === item.text ? { ...i, count: item.count } : i,
          ),
        );
        console.error("Error updating item:", err);
      }
    },
    [handleNeedReauth, setData, setError],
  );

  const increaseItem = useCallback(
    (item: ContainerProps) => updateItemCount(item, 1),
    [updateItemCount],
  );
  const decreaseItem = useCallback(
    (item: ContainerProps) => updateItemCount(item, -1),
    [updateItemCount],
  );

  const navigateScanner = useCallback(
    (count: number) => {
      navigate(`/scanner?text=&count=${encodeURIComponent(count)}`);
    },
    [navigate],
  );

  const displayError = (() => {
    if (!error) return null;

    const normalized = error.toLowerCase();
    const excludedFragments = [
      t("thereAreNoItemsInTheDatabase", "there are no items in the database"),
      "http 401",
      t(
        "authenticationRequiredPleaseSignInAgain",
        "authentication required. please sign in again.",
      ),
    ];

    const isExcluded = excludedFragments.some((fragment) =>
      normalized.includes(fragment),
    );

    return isExcluded ? null : error;
  })();

  if (isLoading && data.length === 0) {
    return (
      <div className="page-center">
        <div style={{ color: "var(--accent)", fontSize: 18 }}>Loading...</div>
      </div>
    );
  }

  const username = localStorage.getItem("username") ?? "L";

  return (
    <div
      style={{
        minHeight: "100vh",
        color: "var(--text-main)",
        fontFamily: "var(--font-body)",
      }}
    >
      {needReauth && (
        <AuthPopup
          onAuthenticated={() => {
            setNeedReauth(false);
            setError(null);
          }}
        />
      )}

      <AppHeader username={username} />

      {displayError ? (
        <ErrorContainer text={displayError} />
      ) : (
        <>
          <TopBar
            sidebarOpen={false}
            onSidebarToggle={() => undefined}
            classNames={availableClasses}
            selectedClass={selectedClass}
            onFilter={filterFetchItems}
            onReset={resetFilters}
            onScanIncrease={() => navigateScanner(1)}
            onScanDecrease={() => navigateScanner(-1)}
            items={data}
            setItems={setData}
            currentSortOrder={sortOrder}
            mode={PageModes.HomePage}
            onSearchStateChange={setIsSearchActive}
            floating={false}
          />

          <div style={{ padding: "0 4px 90px" }}>
            {noItemsAvailable ? (
              <InfoContainer
                text={t(
                  "noItemsAvailableInTheDatabaseSoPerhapsAddOne",
                  "No items available in the database.\nSo perhaps add one.",
                )}
              />
            ) : (
              <Virtuoso
                style={{ height: "calc(100vh - 200px)" }}
                data={visibleData}
                endReached={() => {
                  if (hasMoreData && !isLoading && !isSearchActive) {
                    loadMoreItems();
                  }
                }}
                itemContent={(idx, item) => (
                  <Container
                    key={idx}
                    text={item.text}
                    shortened_name={item.shortened_name}
                    count={item.count}
                    classname={item.classname}
                    perish_dates={item.perish_dates}
                    expiryDays={item.expiryDays}
                    imageUrl={item.imageUrl}
                    ean={item.ean}
                    onClickIncrease={increaseItem}
                    onClickDecrease={decreaseItem}
                    tags={item.tags}
                    isWishedNumber={null}
                    style="m-2"
                  />
                )}
              />
            )}
          </div>
        </>
      )}

      {/* ── Add item FAB ── */}
      <button
        onClick={() => navigate("/scanner")}
        aria-label={t("artikelHinzufgen", "Artikel hinzufügen")}
        style={{
          position: "fixed",
          bottom: 80,
          right: 16,
          width: 52,
          height: 52,
          borderRadius: "50%",
          backgroundColor: "var(--accent-light)",
          border: "1px solid #0d948880",
          color: "var(--accent)",
          fontSize: 26,
          fontWeight: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 4px 20px #00000080, 0 0 0 1px #0d948830",
          zIndex: 90,
          transition: "all 0.15s",
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--accent)";
          (e.currentTarget as HTMLElement).style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--accent-light)";
          (e.currentTarget as HTMLElement).style.color = "var(--accent)";
        }}
      >
        +
      </button>

      <BottomTabBar />
    </div>
  );
}

export default memo(App);
