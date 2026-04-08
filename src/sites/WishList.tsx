import "../App.css";
import Container, { type ContainerProps } from "./../comp/other/Container";
import { useCallback, useEffect, useState, useMemo } from "react";
import ErrorContainer from "./../comp/utils/ErrorContainer";
import { useNavigate } from "react-router-dom";
import type { ApiResponse } from "../lib/utils";
import { transformItems } from "@/lib/utils";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import InfoContainer from "../comp/utils/InfoContainer";
import type { Item } from "../App";
import TopBar from "@/comp/other/TopBar";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import { PageModes } from "../lib/utils";

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
  const [needReauth, setNeedReauth] = useState(false);
  const [accumulatedCount, setAccumulatedCount] = useState<number | null>(null);
  const [distinctItems, setDistinctItems] = useState<number | null>(null);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);

  // ── Planner shopping list (written by MealPlanner, read here) ──────────────
  interface PlannerItem { name: string; amount: number; unit: string; }
  interface PlannerManualItem extends PlannerItem { id: number; fromRecipe: string; }
  const [plannerWeekItems, setPlannerWeekItems]     = useState<PlannerItem[]>([]);
  const [plannerManualItems, setPlannerManualItems] = useState<PlannerManualItem[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem("planner_shopping_list");
        if (!raw) return;
        const parsed = JSON.parse(raw) as { weekPlanItems?: PlannerItem[]; manualItems?: PlannerManualItem[] };
        setPlannerWeekItems(parsed.weekPlanItems ?? []);
        setPlannerManualItems(parsed.manualItems ?? []);
      } catch { /* ignore */ }
    };
    load();
    // Re-read if user navigates back from Planner (storage event fires cross-tab but not same-tab)
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  useEffect(() => {
    if (!hasStoredJwtToken()) {
      setNeedReauth(true);
    }
  }, []);

  const handleNeedReauth = useCallback(() => {
    setNeedReauth(true);
    setError("Authentication required. Please sign in again.");
  }, []);

  const apiCall = useCallback(
    async <T,>(
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
    [],
  );

  // Navigation
  const navigateScanner = useCallback(
    (count: number = 1) => {
      const params = new URLSearchParams({
        wishlist: "true",
        count: String(count),
        text: "",
      });
      navigate(`/scanner?${params}`);
    },
    [navigate],
  );

  // Item count handlers with optimistic updates
  const increaseItemCount = useCallback(
    async (item: ContainerProps) => {
      if (!item.text) return;

      let previousData: Item[] = [];

      // Optimistic update
      setData((prev) => {
        previousData = prev;
        return prev.map((i) =>
          i.ean === item.ean && i.text === item.text
            ? { ...i, count: i.count + 1 }
            : i,
        );
      });

      try {
        await apiCall(
          "/api/add_ean_to_list/",
          {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({
              ean: item.ean,
              item_name: item.text,
              count: 1,
              wish_list: "true",
            }),
          },
          1,
          handleNeedReauth,
        );
      } catch (err) {
        setData(previousData);
        setError("Failed to update item count");
        console.error("Error sending item:", err);
      }
    },
    [apiCall, handleNeedReauth],
  );

  const decreaseItemCount = useCallback(
    async (item: ContainerProps) => {
      if (!item.text) return;

      const willDelete = item.count <= 1;
      let previousData: Item[] = [];

      // Optimistic update
      setData((prev) => {
        previousData = prev;
        if (willDelete) {
          return prev.filter(
            (i) => !(i.ean === item.ean && i.text === item.text),
          );
        }
        return prev.map((i) =>
          i.ean === item.ean && i.text === item.text
            ? { ...i, count: i.count - 1 }
            : i,
        );
      });

      try {
        await apiCall(
          "/api/add_ean_to_list/",
          {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({
              ean: item.ean,
              item_name: item.text,
              count: -1,
              wish_list: "true",
            }),
          },
          1,
          handleNeedReauth,
        );
      } catch (err) {
        setData(previousData);
        setError("Failed to update item count");
        console.error("Error sending item:", err);
      }
    },
    [apiCall, handleNeedReauth],
  );

  // Data fetching with self-healing
  const fetchItems = useCallback(async () => {
    if (!hasStoredJwtToken()) {
      handleNeedReauth();
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiCall<ApiResponse>(
        "/api/fetch_items?only_wish_list=true",
        undefined,
        API_CONFIG.retries,
        handleNeedReauth,
      );
      setData(transformItems(response));
      setAccumulatedCount(response.accumulated_count ?? null);
      setDistinctItems(response.distinct_items ?? null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch wish list";
      setError(message);
      console.error("WishList fetch failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [apiCall, handleNeedReauth]);

  // Derived filter classes from loaded data
  const availableClasses = useMemo(
    () => [...new Set(data.flatMap((item) => item.tags ?? []))].sort(),
    [data],
  );

  // Filtered view
  const filteredData = useMemo(
    () =>
      selectedClass
        ? data.filter((item) => item.tags?.includes(selectedClass))
        : data,
    [data, selectedClass],
  );

  // Memoized container list
  const containerComponents = useMemo(
    () =>
      filteredData.map((item, idx) => (
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
          mapped_items={item.mapped_items ?? []}
          style=""
        />
      )),
    [filteredData, increaseItemCount, decreaseItemCount],
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
      "http 401",
      "authentication required. please sign in again.",
    ];

    const isExcluded = excludedFragments.some((fragment) =>
      normalized.includes(fragment),
    );

    return isExcluded ? null : error;
  })();

  const noItemsAvailable = filteredData.length === 0 && !error && !isLoading;

  const username = localStorage.getItem("username") ?? "L";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0D1117",
        color: "#E8EDF2",
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      {needReauth && (
        <AuthPopup
          onAuthenticated={() => {
            setNeedReauth(false);
            setError(null);
            void fetchItems();
          }}
        />
      )}

      <AppHeader
        username={username}
        
      />

      {displayError ? (
        <ErrorContainer text={displayError} />
      ) : (
        <>
          <TopBar
            sidebarOpen={false}
            onSidebarToggle={() => undefined}
            classNames={availableClasses}
            selectedClass={selectedClass}
            onFilter={(cls) => setSelectedClass(cls)}
            onReset={() => { setSelectedClass(null); void fetchItems(); }}
            onScanIncrease={() => navigateScanner(1)}
            onScanDecrease={() => navigateScanner(-1)}
            items={data}
            setItems={setData}
            currentSortOrder="new-old"
            mode={PageModes.WishPage}
            floating={false}
          />

          {/* ── Category filter chips ── */}
          {availableClasses.length > 0 && (
            <div style={{
              display: "flex",
              gap: 6,
              overflowX: "auto",
              padding: "0 12px 6px",
              scrollbarWidth: "none",
            }}>
              <button
                onClick={() => setSelectedClass(null)}
                style={{
                  flexShrink: 0,
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: `1px solid ${selectedClass === null ? "#0d948880" : "#21262d"}`,
                  backgroundColor: selectedClass === null ? "#0f2a28" : "#161b22",
                  color: selectedClass === null ? "#2dd4bf" : "#8b949e",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  fontFamily: "'DM Sans', system-ui, sans-serif",
                }}
              >
                Alle
              </button>
              {availableClasses.map((cls) => (
                <button
                  key={cls}
                  onClick={() => setSelectedClass(cls === selectedClass ? null : cls)}
                  style={{
                    flexShrink: 0,
                    padding: "4px 12px",
                    borderRadius: 20,
                    border: `1px solid ${selectedClass === cls ? "#0d948880" : "#21262d"}`,
                    backgroundColor: selectedClass === cls ? "#0f2a28" : "#161b22",
                    color: selectedClass === cls ? "#2dd4bf" : "#8b949e",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    whiteSpace: "nowrap",
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                  }}
                >
                  {cls}
                </button>
              ))}
            </div>
          )}

          {(distinctItems !== null || accumulatedCount !== null) && !noItemsAvailable && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "4px 12px 2px",
              padding: "6px 12px",
              borderRadius: 10,
              backgroundColor: "#161b22",
              border: "1px solid #21262d",
            }}>
              {distinctItems !== null && (
                <span style={{ fontSize: 12, color: "#8b949e" }}>
                  <span style={{ fontWeight: 600, color: "#c9d1d9" }}>{distinctItems}</span>
                  {" "}item{distinctItems !== 1 ? "s" : ""}
                </span>
              )}
              {distinctItems !== null && accumulatedCount !== null && (
                <span style={{ color: "#21262d", fontSize: 14 }}>·</span>
              )}
              {accumulatedCount !== null && (
                <span style={{ fontSize: 12, color: "#8b949e" }}>
                  <span style={{ fontWeight: 600, color: "#2dd4bf" }}>{accumulatedCount}</span>
                  {" "}total qty
                </span>
              )}
            </div>
          )}

          {/* ── Planner shopping list ── */}
          {(plannerWeekItems.length > 0 || plannerManualItems.length > 0) && (
            <div style={{ margin: "6px 8px 2px", padding: "12px 14px", borderRadius: 14, backgroundColor: "#161b22", border: "1px solid #21262d" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="13" height="13" fill="none" stroke="#2dd4bf" viewBox="0 0 24 24" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#2dd4bf" }}>Aus Wochenplan</span>
                </div>
                <span style={{ fontSize: 11, color: "#4A5568" }}>{plannerWeekItems.length + plannerManualItems.length} Positionen</span>
              </div>
              {plannerWeekItems.map((item, i) => (
                <div key={`pw-${i}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: i < plannerWeekItems.length - 1 || plannerManualItems.length > 0 ? "1px solid #21262d" : "none" }}>
                  <span style={{ fontSize: 13, color: "#c9d1d9", fontWeight: 500 }}>{item.name}</span>
                  <span style={{ fontSize: 12, color: "#8b949e", fontWeight: 600 }}>{item.amount} {item.unit}</span>
                </div>
              ))}
              {plannerManualItems.map((item, i) => (
                <div key={`pm-${i}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: i < plannerManualItems.length - 1 ? "1px solid #21262d" : "none" }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#c9d1d9", fontWeight: 500 }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: "#4A5568" }}>{item.fromRecipe}</div>
                  </div>
                  <span style={{ fontSize: 12, color: "#8b949e", fontWeight: 600 }}>{item.amount} {item.unit}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ padding: "0 4px 90px" }}>
            {noItemsAvailable ? (
              <InfoContainer
                text={"No items on your wish list.\nAdd something you'd like to buy!"}
              />
            ) : (
              containerComponents
            )}
          </div>
        </>
      )}

      {/* ── Floating add button ── */}
      <button
        onClick={() => navigateScanner(1)}
        aria-label="Artikel hinzufügen"
        style={{
          position: "fixed",
          bottom: 80,
          right: 16,
          width: 52,
          height: 52,
          borderRadius: "50%",
          backgroundColor: "#0f2a28",
          border: "1px solid #0d948880",
          color: "#2dd4bf",
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
          (e.currentTarget as HTMLElement).style.backgroundColor = "#0d9488";
          (e.currentTarget as HTMLElement).style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = "#0f2a28";
          (e.currentTarget as HTMLElement).style.color = "#2dd4bf";
        }}
      >
        +
      </button>

      <BottomTabBar />
    </div>
  );
}

export default WishList;
