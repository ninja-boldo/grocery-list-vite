import { memo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import { buildFetchItemsUrl } from "@/lib/api/openapi";
import type { ApiResponse } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

// ── Types ────────────────────────────────────────────────────────────────────
type Stats = {
  totalItems: number;
  categories: number;
  wishCount: number;
  lowStock: number;
  expiringSoon: number;
};

type RecentItem = {
  ean: string;
  name: string;
  category: string | null;
  qty: number;
  expiryDays: number | null;
  low: boolean;
};

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function parseStats(
  response: ApiResponse,
  isWish: boolean,
): Partial<Stats> & { recent?: RecentItem[] } {
  const now = Date.now();
  const soonThreshold = now + 3 * 86_400_000;
  const cats = new Set<string>();
  let lowStock = 0;
  let expiringSoon = 0;
  const recent: RecentItem[] = [];

  response.items.forEach((item) => {
    const count = Number(item.count ?? 0);
    const rawTags = String(item.tags ?? "");
    const firstTag = rawTags.split(",")[0]?.trim() || null;

    if (firstTag) cats.add(firstTag);
    if (count <= 1) lowStock++;

    const perishDates: string[] = Array.isArray(item.perish_dates)
      ? item.perish_dates
      : [];
    const hasSoon = perishDates.some((d) => {
      const t = new Date(d).getTime();
      return !isNaN(t) && t >= now && t <= soonThreshold;
    });
    if (hasSoon) expiringSoon++;

    if (!isWish && recent.length < 4) {
      const nearestExpiry = perishDates
        .map((d) => new Date(d).getTime())
        .filter((t) => !isNaN(t))
        .sort((a, b) => a - b)[0];

      recent.push({
        ean: item.ean,
        name: item.shortened_name ?? item.text ?? item.ean,
        category: firstTag,
        qty: count,
        expiryDays: nearestExpiry
          ? daysUntil(new Date(nearestExpiry).toISOString())
          : null,
        low: count <= 1,
      });
    }
  });

  return {
    totalItems: response.items.length,
    categories: cats.size,
    lowStock,
    expiringSoon,
    recent,
  };
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const ClockIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const ChevronRight = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--accent)"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// ── Stat card accent colours ──────────────────────────────────────────────────
const CARD_COLORS = {
  inventory: {
    value: "var(--accent)",
    badge: "var(--accent-light)",
    badgeText: "var(--accent-text)",
  },
  wish: {
    value: "var(--info)",
    badge: "var(--info-bg)",
    badgeText: "var(--info)",
  },
  lowStock: {
    value: "var(--error)",
    badge: "var(--error-bg)",
    badgeText: "var(--error)",
  },
  expiringSoon: {
    value: "var(--warning)",
    badge: "var(--warning-bg)",
    badgeText: "var(--warning)",
  },
};

// ── Component ─────────────────────────────────────────────────────────────────
const Dashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [needReauth, setNeedReauth] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    totalItems: 0,
    categories: 0,
    wishCount: 0,
    lowStock: 0,
    expiringSoon: 0,
  });
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const username = localStorage.getItem("username") ?? "L";

  const fetchData = useCallback(async () => {
    if (!hasStoredJwtToken()) {
      setNeedReauth(true);
      return;
    }
    setIsLoading(true);
    try {
      const [invResp, wishResp] = await Promise.all([
        authApiCall<ApiResponse>(
          buildFetchItemsUrl({
            onlyWishList: false,
            sortOrder: "new-old",
            skip: 0,
            limit: 20,
            userId: "1",
          }),
          undefined,
          { retries: 2, onUnauthorized: () => setNeedReauth(true) },
        ),
        authApiCall<ApiResponse>(
          buildFetchItemsUrl({ onlyWishList: true }),
          undefined,
          { retries: 2, onUnauthorized: () => setNeedReauth(true) },
        ),
      ]);
      const invParsed = parseStats(invResp, false);
      setRecentItems(invParsed.recent ?? []);
      setStats({
        totalItems: invParsed.totalItems ?? 0,
        categories: invParsed.categories ?? 0,
        lowStock: invParsed.lowStock ?? 0,
        expiringSoon: invParsed.expiringSoon ?? 0,
        wishCount: wishResp.items.length,
      });
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const currentLang = localStorage.getItem("lang") ?? "en";
    i18n.changeLanguage(currentLang);
    void fetchData();
  }, [fetchData]);

  const statCards = [
    {
      key: "inventory",
      value: stats.totalItems,
      label: t("inventory", "Inventur"),
      sub: t("categoriesCategories", "{{categories}} Kategorien", {
        categories: stats.categories,
      }),
      colors: CARD_COLORS.inventory,
      onClick: () => navigate("/items"),
    },
    {
      key: "wish",
      value: stats.wishCount,
      label: t("wishList", "Einkaufsliste"),
      sub: t("itemsSaved", "items saved"),
      colors: CARD_COLORS.wish,
      onClick: () => navigate("/wish_list"),
    },
    {
      key: "lowStock",
      value: stats.lowStock,
      label: t("lowStock", "Knapper Bestand"),
      sub: t("count1", "Anzahl ≤ 1"),
      colors: CARD_COLORS.lowStock,
      onClick: undefined,
    },
    {
      key: "expiringSoon",
      value: stats.expiringSoon,
      label: t("expiringSoon", "Läuft bald ab"),
      sub: t("next3Days", "Nächste 3 Tage"),
      colors: CARD_COLORS.expiringSoon,
      onClick: undefined,
    },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text-main)",
        fontFamily: "var(--font-body)",
        paddingBottom: 90,
      }}
    >
      {needReauth && (
        <AuthPopup
          onAuthenticated={() => {
            setNeedReauth(false);
            void fetchData();
          }}
        />
      )}

      <AppHeader username={username} />

      <div style={{ padding: "0 14px" }}>
        {/* ── OVERVIEW LABEL ── */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--text-dim)",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          {t("overview", "Übersicht")}
        </div>

        {/* ── STAT CARDS ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginBottom: 24,
          }}
        >
          {statCards.map((card) => (
            <div
              key={card.key}
              onClick={card.onClick}
              role={card.onClick ? "button" : undefined}
              tabIndex={card.onClick ? 0 : undefined}
              style={{
                background: "var(--surface)",
                borderRadius: "var(--radius-lg)",
                padding: "14px 16px",
                border: "1px solid var(--border)",
                cursor: card.onClick ? "pointer" : "default",
                transition: "box-shadow 0.15s, border-color 0.15s",
                boxShadow: "var(--shadow-sm)",
              }}
              onMouseEnter={(e) => {
                if (!card.onClick) return;
                (e.currentTarget as HTMLElement).style.boxShadow =
                  "var(--shadow-md)";
                (e.currentTarget as HTMLElement).style.borderColor =
                  "var(--accent-border)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow =
                  "var(--shadow-sm)";
                (e.currentTarget as HTMLElement).style.borderColor =
                  "var(--border)";
              }}
            >
              {/* coloured value pill */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 40,
                  padding: "2px 10px",
                  borderRadius: "var(--radius-full)",
                  background: card.colors.badge,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: isLoading ? "var(--text-subtle)" : card.colors.value,
                    lineHeight: 1.3,
                    transition: "color 0.2s",
                  }}
                >
                  {isLoading ? "–" : card.value}
                </span>
              </div>

              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-main)",
                  marginBottom: 2,
                }}
              >
                {card.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {card.sub}
                {card.onClick && <ChevronRight />}
              </div>
            </div>
          ))}
        </div>

        {/* ── RECENT ITEMS LABEL ── */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--text-dim)",
              textTransform: "uppercase",
            }}
          >
            {t("recentItems", "Zuletzt hinzugefügt")}
          </div>
          <span
            onClick={() => navigate("/items")}
            style={{
              fontSize: 12,
              color: "var(--accent)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {t("seeAll", "Alle anzeigen")}
          </span>
        </div>

        {/* ── RECENT ITEMS LIST ── */}
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="skeleton"
                style={{
                  borderRadius: "var(--radius-md)",
                  height: 58,
                  opacity: 0.7,
                }}
              />
            ))}
          </div>
        ) : recentItems.length === 0 ? (
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "var(--radius-md)",
              padding: "24px 16px",
              border: "1px solid var(--border)",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            {t(
              "noItemsYetAddSomething",
              "Noch keine Artikel – füge etwas hinzu!",
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recentItems.map((item) => (
              <div
                key={item.ean}
                style={{
                  background: "var(--surface)",
                  borderRadius: "var(--radius-md)",
                  padding: "12px 14px",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                {/* status dot */}
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: item.low ? "var(--error)" : "var(--accent)",
                    flexShrink: 0,
                  }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--text-main)",
                      marginBottom: 3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.name}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {item.category && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: "var(--radius-full)",
                          background: "var(--surface-3)",
                          color: "var(--text-muted)",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        {item.category}
                      </span>
                    )}
                    {item.expiryDays !== null && (
                      <span
                        style={{
                          fontSize: 11,
                          color:
                            item.expiryDays <= 3
                              ? "var(--error)"
                              : "var(--text-dim)",
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <ClockIcon />
                        {item.expiryDays <= 0
                          ? t("expired", "Abgelaufen")
                          : t("expirydaysd", "{{expiryDays}}d", {
                              expiryDays: item.expiryDays,
                            })}
                      </span>
                    )}
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--accent-text)",
                    background: "var(--accent-light)",
                    padding: "2px 8px",
                    borderRadius: "var(--radius-full)",
                    flexShrink: 0,
                  }}
                >
                  {t("qty", "×{{qty}}", { qty: item.qty })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomTabBar />
    </div>
  );
};

export default memo(Dashboard);
