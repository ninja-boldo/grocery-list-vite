import { memo, useEffect, useRef, useState } from "react";
import {
  fetchCloseMarkets,
  getUserLocation,
} from "@/comp/geo/GetCoordPosition";
import Map, { type Position } from "../comp/geo/Map";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import AddSupermarketModal, {
  type AddSupermarketPayload,
} from "@/comp/geo/AddSupermarketModal";
import { authApiCall } from "@/lib/authApi";
import { API_PATHS } from "@/lib/api/openapi";
import FeedbackToast, { useFeedbackToast } from "@/comp/utils/FeedbackToast";
import { useTranslation } from "react-i18next";

// ── Palette — uses CSS variables for full theme support ────────────────────
const P = {
  bg: "var(--bg)",
  surface: "var(--surface)",
  border: "var(--border)",
  teal: "var(--accent)",
  tealD: "var(--accent-light)",
  tealB: "var(--accent-border)",
  text: "var(--text-main)",
  muted: "var(--text-muted)",
  subtle: "var(--text-dim)",
} as const;

// formatMeters is used inside the component where t() is available via hook
// It's passed as a helper; we define a factory that takes t
const makeFormatMeters =
  (t: (key: string, def: string, opts?: object) => string) =>
  (meters: number) => {
    if (meters >= 1000) {
      return t("valKm", "{{val}} km", {
        val: (meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1),
      });
    }
    return t("metersM", "{{meters}} m", { meters });
  };

type AddMarketResponse = {
  status?: string;
  detail?: string;
  message?: string;
};

const GeoSupermarketSite = () => {
  const { t } = useTranslation();
  const formatMeters = makeFormatMeters(t);
  const [userPos, setUserPos] = useState<Position>({
    lon: 1,
    lat: 1,
    valid: false,
  });
  const [markedPositions, setMarkedPositions] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);

  // displayRadius updates immediately (for the slider UI);
  // debouncedRadius trails by 500 ms and triggers the API fetch.
  const [displayRadius, setDisplayRadius] = useState<number>(3000);
  const [debouncedRadius, setDebouncedRadius] = useState<number>(3000);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [needReauth, setNeedReauth] = useState(false);
  const [addSupermarketIsActive, setAddSupermarketIsActive] = useState(false);

  const [toast, showToast, clearToast] = useFeedbackToast(5000);

  // Radius slider: update display value immediately, debounce API trigger
  const handleRadiusChange = (value: number) => {
    setDisplayRadius(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedRadius(value), 500);
  };

  const handleAddSupermarket = async (payload: AddSupermarketPayload) => {
    const response = await authApiCall<AddMarketResponse>(
      API_PATHS.addNewMarket,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (response.status !== "success") {
      showToast(
        response.message ??
          t("backendRejectedMarketUpload", "Backend rejected market upload."),
        "error",
      );
      throw new Error(response.message ?? "Backend rejected market upload.");
    }

    showToast(
      response.detail ??
        t(
          "supermarketSubmittedSuccessfully",
          "Supermarket submitted successfully.",
        ),
      "success",
    );

    if (userPos.valid) {
      await fetchCloseMarkets(
        userPos,
        debouncedRadius,
        setMarkedPositions,
        () => setNeedReauth(true),
      );
    }
  };

  // Get user location once
  useEffect(() => {
    getUserLocation()
      .then((coords) => {
        setUserPos({
          lat: coords.latitude,
          lon: coords.longitude,
          valid: true,
        });
        setError(null);
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });
  }, []);

  // Fetch markets when location or debounced radius changes
  useEffect(() => {
    if (!userPos.valid) return;
    setIsLoading(true);
    setError(null);
    fetchCloseMarkets(userPos, debouncedRadius, setMarkedPositions, () =>
      setNeedReauth(true),
    )
      .catch((err) =>
        setError(err?.message ?? "Failed to fetch nearby supermarkets."),
      )
      .finally(() => setIsLoading(false));
  }, [userPos, debouncedRadius]);

  // Cleanup debounce timer
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const username = localStorage.getItem("username") ?? "L";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "transparent",
        color: P.text,
        fontFamily: "var(--font-body)",
        paddingBottom: 90,
      }}
    >
      {needReauth && <AuthPopup onAuthenticated={() => setNeedReauth(false)} />}

      <AppHeader username={username} />

      <FeedbackToast toast={toast} onDismiss={clearToast} />

      <main style={{ width: "100%", padding: "0 12px" }}>
        {error && (
          <div
            style={{
              marginBottom: 10,
              padding: "10px 14px",
              backgroundColor: "var(--error-bg)",
              border: "1px solid #ef444430",
              borderRadius: 12,
              fontSize: 13,
              color: "var(--error)",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          {/* Map container */}
          {isLoading ? (
            <div
              style={{
                background: P.surface,
                border: `1px solid ${P.border}`,
                borderRadius: 18,
                padding: "32px 16px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: `2px solid var(--accent)`,
                  borderRightColor: "transparent",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <p style={{ marginTop: 10, fontSize: 13, color: P.muted }}>
                {t(
                  "loadingMapAndNearbySupermarkets",
                  "Loading map and nearby supermarkets...",
                )}
              </p>
            </div>
          ) : (
            <div
              style={{
                background: P.surface,
                border: `1px solid ${P.border}`,
                borderRadius: 18,
                overflow: "hidden",
                boxShadow: "0 8px 32px #00000040",
              }}
            >
              <Map
                key={`${userPos.lat}-${userPos.lon}`}
                height="62vh"
                zoom={12}
                centerPos={userPos}
                markedPositions={markedPositions}
              />
            </div>
          )}

          {/* Controls card */}
          <div
            style={{
              marginTop: 10,
              background: P.surface,
              border: `1px solid ${P.border}`,
              borderRadius: 16,
              padding: "14px 16px",
            }}
          >
            {/* Radius control */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  color: P.subtle,
                  textTransform: "uppercase",
                }}
              >
                {t("radius", "Radius")}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: P.teal }}>
                  {formatMeters(displayRadius)}
                </span>
                <button
                  onClick={() => {
                    setDisplayRadius(3000);
                    handleRadiusChange(3000);
                  }}
                  style={{
                    all: "unset",
                    boxSizing: "border-box",
                    padding: "3px 10px",
                    borderRadius: 8,
                    border: `1px solid ${P.border}`,
                    backgroundColor: P.bg,
                    color: P.muted,
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor =
                      P.tealB;
                    (e.currentTarget as HTMLElement).style.color =
                      "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor =
                      P.border;
                    (e.currentTarget as HTMLElement).style.color = P.muted;
                  }}
                >
                  {t("reset", "Reset")}
                </button>
              </div>
            </div>

            <input
              id="radius-slider"
              type="range"
              min={500}
              max={10000}
              step={250}
              value={displayRadius}
              onChange={(e) => handleRadiusChange(Number(e.target.value))}
              style={{
                width: "100%",
                accentColor: P.teal,
                cursor: "pointer",
              }}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 2,
                fontSize: 10,
                color: P.subtle,
              }}
            >
              <span>{t("500M", "500 m")}</span>
              <span>{t("10Km", "10 km")}</span>
            </div>

            {/* Divider */}
            <div
              style={{
                borderTop: `1px solid ${P.border}`,
                margin: "12px 0",
              }}
            />

            {/* Add supermarket button */}
            <button
              onClick={() => setAddSupermarketIsActive(true)}
              style={{
                all: "unset",
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                width: "100%",
                padding: "11px 0",
                borderRadius: 12,
                backgroundColor: P.tealD,
                border: `1px solid ${P.tealB}`,
                color: "var(--accent)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "var(--accent-light)";
                (e.currentTarget as HTMLElement).style.borderColor =
                  `var(--accent)80`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  P.tealD;
                (e.currentTarget as HTMLElement).style.borderColor = P.tealB;
              }}
            >
              <svg
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t("addSupermarket", "Add Supermarket")}
            </button>
          </div>
        </div>

        {addSupermarketIsActive && (
          <AddSupermarketModal
            isOpen={addSupermarketIsActive}
            onClose={() => setAddSupermarketIsActive(false)}
            onSubmit={handleAddSupermarket}
          />
        )}
      </main>

      <BottomTabBar />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default memo(GeoSupermarketSite);
