import { memo, useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import type { ApiResponse } from "@/lib/utils";

type InventoryStats = {
  distinctItems: number;
  totalCount: number;
  lowStockItems: number;
  uniqueTags: number;
  expiringSoonItems: number;
};

type FetchItemsResponse = ApiResponse & {
  distinct_items?: number;
  accumulated_count?: number;
};

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: "#161b22",
  border: "1px solid #21262d",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 8px 32px #00000060",
};

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid #2a313b",
  backgroundColor: "#0d1117",
  color: "#e6edf3",
  padding: "10px 12px",
  outline: "none",
  fontSize: 14,
};

const BTN_PRIMARY: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid #0d948850",
  backgroundColor: "#0f2a28",
  color: "#5eead4",
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s",
  minHeight: 38,
};

const BTN_SECONDARY: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid #21262d",
  backgroundColor: "#161b22",
  color: "#8b949e",
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s",
  minHeight: 38,
};

const emptyStats: InventoryStats = {
  distinctItems: 0,
  totalCount: 0,
  lowStockItems: 0,
  uniqueTags: 0,
  expiringSoonItems: 0,
};

const parseDate = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const aggregateStats = (response: FetchItemsResponse): InventoryStats => {
  const now = Date.now();
  const soonThreshold = now + 1000 * 60 * 60 * 24 * 3;
  const uniqueTags = new Set<string>();

  let expiringSoonItems = 0;
  response.items.forEach((item) => {
    const rawTags = (item.tags ?? "").toString();
    rawTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach((tag) => uniqueTags.add(tag));

    const hasSoonDate = (item.perish_dates ?? []).some((dateString) => {
      const date = parseDate(dateString);
      if (!date) return false;
      const ts = date.getTime();
      return ts >= now && ts <= soonThreshold;
    });

    if (hasSoonDate) {
      expiringSoonItems += 1;
    }
  });

  return {
    distinctItems: response.distinct_items ?? response.items.length,
    totalCount:
      response.accumulated_count ??
      response.items.reduce((sum, item) => sum + Number(item.count || 0), 0),
    lowStockItems: response.items.filter((item) => Number(item.count || 0) <= 1)
      .length,
    uniqueTags: uniqueTags.size,
    expiringSoonItems,
  };
};

const Settings = () => {
  const [needReauth, setNeedReauth] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inventoryStats, setInventoryStats] =
    useState<InventoryStats>(emptyStats);
  const [wishStats, setWishStats] = useState<InventoryStats>(emptyStats);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusVariant, setStatusVariant] = useState<"ok" | "error">("ok");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  const username = useMemo(
    () => localStorage.getItem("username") ?? "unknown",
    [],
  );

  useEffect(() => {
    if (!hasStoredJwtToken()) {
      setNeedReauth(true);
    }
  }, []);

  const handleNeedReauth = useCallback(() => {
    setNeedReauth(true);
    setStatusVariant("error");
    setStatusMessage("Authentication required. Please sign in again.");
  }, []);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setStatusMessage(null);

    try {
      const [itemsResp, wishResp] = await Promise.all([
        authApiCall<FetchItemsResponse>(
          "/api/fetch_items?only_wish_list=false",
          undefined,
          { retries: 1, onUnauthorized: handleNeedReauth },
        ),
        authApiCall<FetchItemsResponse>(
          "/api/fetch_items?only_wish_list=true",
          undefined,
          { retries: 1, onUnauthorized: handleNeedReauth },
        ),
      ]);

      setInventoryStats(aggregateStats(itemsResp));
      setWishStats(aggregateStats(wishResp));
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        return;
      }
      setStatusVariant("error");
      setStatusMessage("Failed to load stats. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [handleNeedReauth]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const handlePasswordSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (!currentPassword || !newPassword || !confirmPassword) {
        setStatusVariant("error");
        setStatusMessage("Please fill in all password fields.");
        return;
      }

      if (newPassword.length < 4) {
        setStatusVariant("error");
        setStatusMessage("New password must be at least 4 characters.");
        return;
      }

      if (newPassword !== confirmPassword) {
        setStatusVariant("error");
        setStatusMessage("New password and confirmation do not match.");
        return;
      }

      setIsSubmittingPassword(true);
      setStatusMessage(null);

      try {
        await authApiCall(
          "/api/change_password",
          {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({
              current_password: currentPassword,
              new_password: newPassword,
            }),
          },
          { retries: 1, onUnauthorized: handleNeedReauth },
        );

        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setStatusVariant("ok");
        setStatusMessage("Password updated successfully.");
      } catch (err) {
        if (err instanceof Error && err.message.includes("401")) {
          setStatusVariant("error");
          setStatusMessage("Current password is incorrect or session expired.");
          return;
        }
        setStatusVariant("error");
        setStatusMessage("Could not update password. Please try again.");
      } finally {
        setIsSubmittingPassword(false);
      }
    },
    [confirmPassword, currentPassword, handleNeedReauth, newPassword],
  );

  const handleSignOut = useCallback(() => {
    localStorage.removeItem("jwt_auth");
    localStorage.removeItem("username");
    setNeedReauth(true);
    setStatusVariant("ok");
    setStatusMessage("Signed out. Please authenticate again.");
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0D1117",
        color: "#E8EDF2",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        paddingBottom: 90,
      }}
    >
      {needReauth && (
        <AuthPopup
          onAuthenticated={() => {
            setNeedReauth(false);
            setStatusMessage(null);
            void fetchStats();
          }}
        />
      )}

      <AppHeader
        username={username}
        onAvatarClick={() => setNeedReauth(true)}
      />

      <div style={{ padding: "0 12px" }}>
        <div className="max-w-5xl mx-auto" style={{ display: "grid", gap: 14 }}>
          {statusMessage && (
            <div
              style={{
                ...CARD_STYLE,
                borderColor: statusVariant === "ok" ? "#0d948850" : "#ef444430",
                color: statusVariant === "ok" ? "#5eead4" : "#fca5a5",
                fontSize: 13,
              }}
            >
              {statusMessage}
            </div>
          )}

          <section style={CARD_STYLE}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#5eead4" }}>
              Account
            </h2>
            <p style={{ margin: "6px 0 14px", fontSize: 12, color: "#8b949e" }}>
              Logged in as{" "}
              <strong style={{ color: "#e6edf3" }}>{username}</strong>
            </p>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={handleSignOut} style={BTN_SECONDARY}>
                Sign out
              </button>
              <button onClick={() => setNeedReauth(true)} style={BTN_PRIMARY}>
                Re-authenticate
              </button>
              <button
                onClick={() => void fetchStats()}
                style={BTN_PRIMARY}
                disabled={isLoading}
              >
                {isLoading ? "Refreshing..." : "Refresh stats"}
              </button>
            </div>
          </section>

          <section style={CARD_STYLE}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#5eead4" }}>
              Password
            </h2>
            <p style={{ margin: "6px 0 14px", fontSize: 12, color: "#8b949e" }}>
              Update your password. You need your current password to confirm
              this change.
            </p>

            <form
              onSubmit={handlePasswordSubmit}
              style={{ display: "grid", gap: 10 }}
            >
              <input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(event) =>
                  setCurrentPassword(event.currentTarget.value)
                }
                style={FIELD_STYLE}
              />
              <input
                type="password"
                placeholder="New password (min. 4 chars)"
                value={newPassword}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
                style={FIELD_STYLE}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.currentTarget.value)
                }
                style={FIELD_STYLE}
              />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  style={BTN_PRIMARY}
                  disabled={isSubmittingPassword}
                >
                  {isSubmittingPassword ? "Updating..." : "Update password"}
                </button>
              </div>
            </form>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
              gap: 10,
            }}
          >
            <div style={CARD_STYLE}>
              <div style={{ fontSize: 12, color: "#6e7681" }}>
                Inventory items
              </div>
              <div style={{ fontSize: 28, color: "#e6edf3", fontWeight: 700 }}>
                {inventoryStats.distinctItems}
              </div>
              <div style={{ fontSize: 12, color: "#8b949e" }}>
                Total count: {inventoryStats.totalCount}
              </div>
            </div>

            <div style={CARD_STYLE}>
              <div style={{ fontSize: 12, color: "#6e7681" }}>
                Wish list items
              </div>
              <div style={{ fontSize: 28, color: "#e6edf3", fontWeight: 700 }}>
                {wishStats.distinctItems}
              </div>
              <div style={{ fontSize: 12, color: "#8b949e" }}>
                Total count: {wishStats.totalCount}
              </div>
            </div>

            <div style={CARD_STYLE}>
              <div style={{ fontSize: 12, color: "#6e7681" }}>Low stock</div>
              <div style={{ fontSize: 28, color: "#f59e0b", fontWeight: 700 }}>
                {inventoryStats.lowStockItems}
              </div>
              <div style={{ fontSize: 12, color: "#8b949e" }}>
                Items with count {"<="} 1
              </div>
            </div>

            <div style={CARD_STYLE}>
              <div style={{ fontSize: 12, color: "#6e7681" }}>
                Expiring soon
              </div>
              <div style={{ fontSize: 28, color: "#38bdf8", fontWeight: 700 }}>
                {inventoryStats.expiringSoonItems}
              </div>
              <div style={{ fontSize: 12, color: "#8b949e" }}>
                Within next 3 days
              </div>
            </div>

            <div style={CARD_STYLE}>
              <div style={{ fontSize: 12, color: "#6e7681" }}>
                Unique categories
              </div>
              <div style={{ fontSize: 28, color: "#22c55e", fontWeight: 700 }}>
                {inventoryStats.uniqueTags}
              </div>
              <div style={{ fontSize: 12, color: "#8b949e" }}>
                Based on item tags
              </div>
            </div>
          </section>
        </div>
      </div>

      <BottomTabBar />
    </div>
  );
};

export default memo(Settings);
