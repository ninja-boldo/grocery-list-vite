import { memo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import { buildFetchItemsUrl } from "@/lib/api/openapi";
import type { ApiResponse } from "@/lib/utils";

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

// ── Palette ──────────────────────────────────────────────────────────────────
const teal = "#1D9E75";
const red = "#E24B4A";
const amber = "#BA7517";
const P = {
  bg: "#0D1117",
  surface: "#161B22",
  border: "#21262D",
  text: "#E8EDF2",
  muted: "#6B7A8A",
  subtle: "#4A5568",
};

const categoryColors: Record<string, { bg: string; text: string }> = {
  Dairy:      { bg: "#E6F1FB", text: "#378ADD" },
  Bakery:     { bg: "#FAEEDA", text: "#BA7517" },
  Produce:    { bg: "#E1F5EE", text: "#0F6E56" },
  Pantry:     { bg: "#F1EFE8", text: "#5F5E5A" },
  Condiments: { bg: "#FBEAF0", text: "#993556" },
};

function getCatStyle(cat: string | null) {
  const c = cat ? (categoryColors[cat] ?? { bg: "#F1EFE8", text: "#5F5E5A" }) : { bg: "#F1EFE8", text: "#5F5E5A" };
  return c;
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseStats(response: ApiResponse, isWish: boolean): Partial<Stats> & { recent?: RecentItem[] } {
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

    const perishDates: string[] = Array.isArray(item.perish_dates) ? item.perish_dates : [];
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
        expiryDays: nearestExpiry ? daysUntil(new Date(nearestExpiry).toISOString()) : null,
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
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────
const Dashboard = () => {
  const navigate = useNavigate();
  const [needReauth, setNeedReauth] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ totalItems: 0, categories: 0, wishCount: 0, lowStock: 0, expiringSoon: 0 });
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);

  const username = localStorage.getItem("username") ?? "L";

  const fetchData = useCallback(async () => {
    if (!hasStoredJwtToken()) { setNeedReauth(true); return; }
    setIsLoading(true);
    try {
      const [invResp, wishResp] = await Promise.all([
        authApiCall<ApiResponse>(buildFetchItemsUrl({ onlyWishList: false, sortOrder: "new-old", skip: 0, limit: 20, userId: "1" }), undefined, { retries: 2, onUnauthorized: () => setNeedReauth(true) }),
        authApiCall<ApiResponse>(buildFetchItemsUrl({ onlyWishList: true }), undefined, { retries: 2, onUnauthorized: () => setNeedReauth(true) }),
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
      // silently fail – stats stay at 0
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const statCards = [
    {
      value: stats.totalItems,
      label: "Inventory",
      sub: `${stats.categories} categories`,
      color: teal,
      onClick: () => navigate("/items"),
    },
    {
      value: stats.wishCount,
      label: "Wish List",
      sub: "Items saved",
      color: P.text,
      onClick: () => navigate("/wish_list"),
    },
    {
      value: stats.lowStock,
      label: "Low Stock",
      sub: "Count ≤ 1",
      color: red,
      onClick: undefined,
    },
    {
      value: stats.expiringSoon,
      label: "Expiring Soon",
      sub: "Next 3 days",
      color: amber,
      onClick: undefined,
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: P.bg, color: P.text, fontFamily: "'DM Sans', system-ui, sans-serif", paddingBottom: 90 }}>
      {needReauth && (
        <AuthPopup onAuthenticated={() => { setNeedReauth(false); void fetchData(); }} />
      )}

      <AppHeader username={username} />

      <div style={{ padding: "0 16px" }}>

        {/* ── OVERVIEW ── */}
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: P.subtle, textTransform: "uppercase", marginBottom: 10 }}>
          Overview
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
          {statCards.map((card) => (
            <div
              key={card.label}
              onClick={card.onClick}
              style={{
                background: P.surface,
                borderRadius: 14,
                padding: "14px 16px",
                border: `1px solid ${P.border}`,
                cursor: card.onClick ? "pointer" : "default",
                transition: card.onClick ? "border-color 0.15s, background 0.15s" : undefined,
              }}
              onMouseEnter={(e) => {
                if (card.onClick) {
                  (e.currentTarget as HTMLElement).style.borderColor = teal + "60";
                  (e.currentTarget as HTMLElement).style.background = "#1a2332";
                }
              }}
              onMouseLeave={(e) => {
                if (card.onClick) {
                  (e.currentTarget as HTMLElement).style.borderColor = P.border;
                  (e.currentTarget as HTMLElement).style.background = P.surface;
                }
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 700, color: isLoading ? P.subtle : card.color, lineHeight: 1, marginBottom: 4, transition: "color 0.2s" }}>
                {isLoading ? "—" : card.value}
              </div>
              <div style={{ fontSize: 12, color: P.muted, fontWeight: 500 }}>{card.label}</div>
              <div style={{ fontSize: 11, color: P.subtle, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                {card.sub}
                {card.onClick && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={teal} strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </div>
            </div>
          ))}
        </div>


        {/* ── RECENT ITEMS ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: P.subtle, textTransform: "uppercase" }}>
            Recent Items
          </div>
          <span
            onClick={() => navigate("/items")}
            style={{ fontSize: 12, color: teal, cursor: "pointer", fontWeight: 500 }}
          >
            See all
          </span>
        </div>

        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ background: P.surface, borderRadius: 12, padding: "12px 14px", border: `1px solid ${P.border}`, height: 56, opacity: 0.5 }} />
            ))}
          </div>
        ) : recentItems.length === 0 ? (
          <div style={{ background: P.surface, borderRadius: 12, padding: "20px 16px", border: `1px solid ${P.border}`, textAlign: "center", color: P.subtle, fontSize: 13 }}>
            No items yet — add something!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recentItems.map((item) => {
              const catStyle = getCatStyle(item.category);
              return (
                <div
                  key={item.ean}
                  style={{ background: P.surface, borderRadius: 12, padding: "12px 14px", border: `1px solid ${P.border}`, display: "flex", alignItems: "center", gap: 12 }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.low ? red : teal, flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: P.text, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {item.category && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: catStyle.bg, color: catStyle.text }}>
                          {item.category}
                        </span>
                      )}
                      {item.expiryDays !== null && (
                        <span style={{ fontSize: 11, color: item.expiryDays <= 3 ? red : P.subtle, display: "flex", alignItems: "center", gap: 3 }}>
                          <ClockIcon />
                          {item.expiryDays <= 0 ? "Expired" : `${item.expiryDays}d`}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: P.muted, flexShrink: 0 }}>×{item.qty}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BottomTabBar />
    </div>
  );
};

export default memo(Dashboard);
