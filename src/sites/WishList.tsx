import "../App.css";
import Container, { type ContainerProps } from "./../comp/other/Container";
import { useCallback, useEffect, useState, useMemo } from "react";
import ErrorContainer from "./../comp/utils/ErrorContainer";
import { useNavigate } from "react-router-dom";
import type { ApiResponse } from "../lib/utils";
import { transformItems } from "@/lib/utils";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import { apiClient } from "@/lib/api/client";
import { isAddEanSuccess } from "@/lib/api/addEanFlow";
import InfoContainer from "../comp/utils/InfoContainer";
import type { Item } from "../App";
import TopBar from "@/comp/other/TopBar";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import FeedbackToast, { useFeedbackToast } from "@/comp/utils/FeedbackToast";
import { PageModes } from "../lib/utils";
import {
  buildFetchItemsUrl,
  PantryClassificationWishItem,
} from "@/lib/api/openapi";
import { useTranslation } from "react-i18next";

const API_CONFIG = {
  retries: 3,
  baseDelay: 1000,
  timeout: 10000,
} as const;

const normalizeItemName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function WishList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [needReauth, setNeedReauth] = useState(false);
  const [accumulatedCount, setAccumulatedCount] = useState<number | null>(null);
  const [distinctItems, setDistinctItems] = useState<number | null>(null);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [pantryItemNames, setPantryItemNames] = useState<Set<string>>(
    new Set(),
  );
  const [isCheckingPantry, setIsCheckingPantry] = useState(false);
  const [toast, showToast, clearToast] = useFeedbackToast(3500);

  useEffect(() => {
    if (!hasStoredJwtToken()) setNeedReauth(true);
    const currentLang = localStorage.getItem("lang") ?? "en";
    i18n.changeLanguage(currentLang);
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

  const increaseItemCount = useCallback(
    async (item: ContainerProps) => {
      if (!item.text) return;
      let previousData: Item[] = [];
      setData((prev) => {
        previousData = prev;
        return prev.map((i) =>
          i.ean === item.ean && i.text === item.text
            ? { ...i, count: i.count + 1 }
            : i,
        );
      });
      try {
        const response = await apiClient.addEanToList(
          { ean: item.ean, item_name: item.text, count: 1, wish_list: "true" },
          { retries: 1, retryDelayMs: 300, onUnauthorized: handleNeedReauth },
        );
        if (!isAddEanSuccess(response))
          throw new Error("Failed to update item count");
      } catch {
        setData(previousData);
        setError("Failed to update item count");
      }
    },
    [handleNeedReauth],
  );

  const decreaseItemCount = useCallback(
    async (item: ContainerProps) => {
      if (!item.text) return;
      const willDelete = item.count <= 1;
      let previousData: Item[] = [];
      setData((prev) => {
        previousData = prev;
        if (willDelete)
          return prev.filter(
            (i) => !(i.ean === item.ean && i.text === item.text),
          );
        return prev.map((i) =>
          i.ean === item.ean && i.text === item.text
            ? { ...i, count: i.count - 1 }
            : i,
        );
      });
      try {
        const response = await apiClient.addEanToList(
          { ean: item.ean, item_name: item.text, count: -1, wish_list: "true" },
          { retries: 1, retryDelayMs: 300, onUnauthorized: handleNeedReauth },
        );
        if (!isAddEanSuccess(response))
          throw new Error("Failed to update item count");
      } catch {
        setData(previousData);
        setError("Failed to update item count");
      }
    },
    [handleNeedReauth],
  );

  const fetchItems = useCallback(async () => {
    if (!hasStoredJwtToken()) {
      handleNeedReauth();
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiCall<ApiResponse>(
        buildFetchItemsUrl({ onlyWishList: true }),
        undefined,
        API_CONFIG.retries,
        handleNeedReauth,
      );
      setData(transformItems(response));
      setAccumulatedCount(response.accumulated_count ?? null);
      setDistinctItems(response.distinct_items ?? null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("failedToFetchWishList", "Failed to fetch wish list");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [apiCall, handleNeedReauth]);

  const handleCheckPantry = useCallback(async () => {
    if (!hasStoredJwtToken()) {
      handleNeedReauth();
      return;
    }
    if (data.length === 0) return;
    setIsCheckingPantry(true);
    try {
      const wishlistItems: PantryClassificationWishItem[] = data.map(
        (item, idx) => ({
          item_name: item.text ?? "",
          item_id: `wish-${idx}`,
          count: item.count,
          quantity: {
            product_quantity: item.count > 0 ? item.count : 1,
            product_quantity_unit: null,
          },
        }),
      );

      const result = await apiClient.classifyItemsAgainstPantry(wishlistItems, {
        retries: 1,
        onUnauthorized: handleNeedReauth,
        autoAddItems: true,
      });

      const foundNames = new Set<string>();
      const normalizedWishlistTexts = new Set(
        data.map((item) => normalizeItemName(item.text ?? "")),
      );

      for (const entry of result.mapping ?? []) {
        if (entry.foundMappingWish && entry.mappedWishItem?.item_name) {
          const normalizedMapped = normalizeItemName(
            entry.mappedWishItem.item_name,
          );
          if (normalizedWishlistTexts.has(normalizedMapped))
            foundNames.add(normalizedMapped);
        }
      }

      setPantryItemNames(foundNames);
      const matchedCount = data.filter((item) =>
        foundNames.has(normalizeItemName(item.text ?? "")),
      ).length;

      if (matchedCount > 0) {
        showToast(
          t(
            "matchedCountOfTotalInPantry",
            "{{matchedCount}} von {{total}} Wunschlistenartikeln bereits im Vorrat.",
            { matchedCount, total: data.length },
          ),
          "success",
        );
      } else {
        showToast(
          t(
            "noPantryMatches",
            "Kein Wunschlistenartikel ist derzeit im Vorrat.",
          ),
          "info",
        );
      }
    } catch {
      showToast(
        t(
          "pantryCheckFailed",
          "Vorrat konnte nicht überprüft werden. Bitte erneut versuchen.",
        ),
        "error",
      );
    } finally {
      setIsCheckingPantry(false);
    }
  }, [data, handleNeedReauth, showToast]);

  const availableClasses = useMemo(
    () => [...new Set(data.flatMap((item) => item.tags ?? []))].sort(),
    [data],
  );

  const filteredData = useMemo(
    () =>
      selectedClass
        ? data.filter((item) => item.tags?.includes(selectedClass))
        : data,
    [data, selectedClass],
  );

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
          expiryDays={item.expiryDays}
          style=""
        />
      )),
    [filteredData, increaseItemCount, decreaseItemCount],
  );

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  if (isLoading && data.length === 0 && !needReauth) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            color: "var(--accent)",
            fontSize: 14,
            fontFamily: "var(--font-body)",
          }}
        >
          {t("Loading", "Laden")}…
        </div>
      </div>
    );
  }

  const displayError = (() => {
    if (!error) return null;
    const normalized = error.toLowerCase();
    const excluded = [
      "http 401",
      t(
        "authenticationRequiredPleaseSignInAgain",
        "authentication required. please sign in again.",
      ).toLowerCase(),
    ];
    return excluded.some((f) => normalized.includes(f)) ? null : error;
  })();

  const noItemsAvailable = filteredData.length === 0 && !error && !isLoading;
  const username = localStorage.getItem("username") ?? "L";

  return (
    <div
      style={{
        minHeight: "100vh",
        color: "var(--text-main)",
        fontFamily: "var(--font-body)",
        background: "var(--bg)",
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
            onFilter={(cls) => setSelectedClass(cls)}
            onReset={() => {
              setSelectedClass(null);
              void fetchItems();
            }}
            onScanIncrease={() => navigateScanner(1)}
            onScanDecrease={() => navigateScanner(-1)}
            items={data}
            setItems={setData}
            currentSortOrder="new-old"
            mode={PageModes.WishPage}
            floating={false}
          />

          {/* ── Category chips ── */}
          {availableClasses.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: 6,
                overflowX: "auto",
                padding: "0 12px 6px",
                scrollbarWidth: "none",
              }}
            >
              <button
                onClick={() => setSelectedClass(null)}
                style={{
                  flexShrink: 0,
                  padding: "4px 12px",
                  borderRadius: "var(--radius-full)",
                  border: `1px solid ${selectedClass === null ? "var(--accent-border)" : "var(--border)"}`,
                  backgroundColor:
                    selectedClass === null
                      ? "var(--accent-light)"
                      : "var(--surface)",
                  color:
                    selectedClass === null
                      ? "var(--accent-text)"
                      : "var(--text-muted)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  fontFamily: "var(--font-body)",
                }}
              >
                {t("alle", "Alle")}
              </button>
              {availableClasses.map((cls) => (
                <button
                  key={cls}
                  onClick={() =>
                    setSelectedClass(cls === selectedClass ? null : cls)
                  }
                  style={{
                    flexShrink: 0,
                    padding: "4px 12px",
                    borderRadius: "var(--radius-full)",
                    border: `1px solid ${selectedClass === cls ? "var(--accent-border)" : "var(--border)"}`,
                    backgroundColor:
                      selectedClass === cls
                        ? "var(--accent-light)"
                        : "var(--surface)",
                    color:
                      selectedClass === cls
                        ? "var(--accent-text)"
                        : "var(--text-muted)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  {cls}
                </button>
              ))}
            </div>
          )}

          {/* ── Item count summary ── */}
          {(distinctItems !== null || accumulatedCount !== null) &&
            !noItemsAvailable && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "4px 12px 2px",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              >
                {distinctItems !== null && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    <span
                      style={{ fontWeight: 700, color: "var(--text-main)" }}
                    >
                      {distinctItems}
                    </span>{" "}
                    {distinctItems !== 1
                      ? t("items", "Artikel")
                      : t("item", "Artikel")}
                  </span>
                )}
                {distinctItems !== null && accumulatedCount !== null && (
                  <span style={{ color: "var(--border-strong)", fontSize: 14 }}>
                    ·
                  </span>
                )}
                {accumulatedCount !== null && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    <span style={{ fontWeight: 700, color: "var(--accent)" }}>
                      {accumulatedCount}
                    </span>{" "}
                    {t("totalQty", "Gesamt")}
                  </span>
                )}
              </div>
            )}

          {/* ── Check Pantry button ── */}
          {data.length > 0 && (
            <div style={{ padding: "6px 12px 0" }}>
              <button
                type="button"
                onClick={() => void handleCheckPantry()}
                disabled={isCheckingPantry}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--accent-border)",
                  background: isCheckingPantry
                    ? "var(--accent-light)"
                    : "var(--surface)",
                  color: isCheckingPantry
                    ? "var(--text-subtle)"
                    : "var(--accent)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isCheckingPantry ? "not-allowed" : "pointer",
                  transition: "all 0.15s",
                  fontFamily: "var(--font-body)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <svg
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                  <rect x="9" y="3" width="6" height="4" rx="1" />
                  <path d="M9 14l2 2 4-4" />
                </svg>
                {isCheckingPantry
                  ? `${t("checkingPantry", "Vorrat wird überprüft")}…`
                  : t("checkPantry", "Vorrat überprüfen")}
              </button>
            </div>
          )}

          {/* ── Pantry match result ── */}
          {pantryItemNames.size > 0 && (
            <div
              style={{
                margin: "6px 12px 0",
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--success-bg)",
                border: "1px solid var(--success-border)",
                fontSize: 12,
                color: "var(--accent-text)",
                lineHeight: 1.5,
              }}
            >
              <strong>{t("alreadyInPantry", "Bereits im Vorrat:")}</strong>{" "}
              {[...pantryItemNames].slice(0, 5).join(", ")}
              {pantryItemNames.size > 5
                ? t("andValMore", "und {{val}} weitere", {
                    val: pantryItemNames.size - 5,
                  })
                : ""}
            </div>
          )}

          {/* ── Item list ── */}
          <div style={{ padding: "0 4px 90px" }}>
            {noItemsAvailable ? (
              <InfoContainer
                text={t(
                  "noItemsOnYourWishListAddSomethingYoudLikeToBuy",
                  "Keine Artikel auf der Einkaufsliste.\nFüge etwas hinzu!",
                )}
              />
            ) : (
              containerComponents
            )}
          </div>
        </>
      )}

      {/* ── FAB ── */}
      <button
        onClick={() => navigateScanner(1)}
        aria-label={t("artikelHinzufgen", "Artikel hinzufügen")}
        style={{
          position: "fixed",
          bottom: 80,
          right: 16,
          width: 52,
          height: 52,
          borderRadius: "50%",
          backgroundColor: "var(--accent)",
          border: "none",
          color: "#fff",
          fontSize: 26,
          fontWeight: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(46,125,82,0.35)",
          zIndex: 90,
          transition: "all 0.15s",
          fontFamily: "var(--font-body)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--accent-hover)";
          (e.currentTarget as HTMLElement).style.boxShadow =
            "0 6px 24px rgba(46,125,82,0.45)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--accent)";
          (e.currentTarget as HTMLElement).style.boxShadow =
            "0 4px 20px rgba(46,125,82,0.35)";
        }}
      >
        +
      </button>

      <FeedbackToast toast={toast} onDismiss={clearToast} />
      <BottomTabBar />
    </div>
  );
}

export default WishList;
