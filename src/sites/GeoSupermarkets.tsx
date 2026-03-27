import { memo, useEffect, useState } from "react";
import {
  fetchCloseMarkets,
  getUserLocation,
} from "@/comp/geo/GetCoordPosition";
import Map, { type Position } from "../comp/geo/Map";
import TopBar from "@/comp/other/TopBar";
import { PageModes } from "@/lib/utils";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import AddSupermarketModal, {
  type AddSupermarketPayload,
} from "@/comp/geo/AddSupermarketModal";
import { authApiCall } from "@/lib/authApi";

const formatMeters = (meters: number) => {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)} km`;
  }
  return `${meters} m`;
};

type AddMarketResponse = {
  status?: string;
  detail?: string;
  message?: string;
};

const GeoSupermarketSite = () => {
  const [userPos, setUserPos] = useState<Position>({
    lon: 1,
    lat: 1,
    valid: false,
  });
  const [markedPositions, setMarkedPositions] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [supermarketRadius, setSupermarketRadius] = useState<number>(3000);
  const [showRadiusControls, setShowRadiusControls] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [needReauth, setNeedReauth] = useState(false);
  const [addSupermarketIsActive, setAddSupermarketIsActive] = useState(false);
  const [addMarketFeedback, setAddMarketFeedback] = useState<string | null>(
    null,
  );

  const handleAddSupermarket = async (payload: AddSupermarketPayload) => {
    const response = await authApiCall<AddMarketResponse>(
      "/api/add_new_market",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (response.status !== "success") {
      throw new Error(response.message ?? "Backend rejected market upload.");
    }

    setAddMarketFeedback(
      response.detail ?? "Backend received your supermarket successfully.",
    );

    if (userPos.valid) {
      await fetchCloseMarkets(
        userPos,
        supermarketRadius,
        setMarkedPositions,
        () => setNeedReauth(true),
      );
    }
  };

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

  useEffect(() => {
    if (!userPos.valid) {
      return;
    }

    setIsLoading(true);
    setError(null);
    fetchCloseMarkets(userPos, supermarketRadius, setMarkedPositions, () =>
      setNeedReauth(true),
    )
      .catch((err) =>
        setError(err?.message ?? "Failed to fetch nearby supermarkets."),
      )
      .finally(() => setIsLoading(false));
  }, [userPos, supermarketRadius, setError]);

  useEffect(() => {
    if (!addMarketFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAddMarketFeedback(null);
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [addMarketFeedback]);

  const username = localStorage.getItem("username") ?? "L";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0D1117",
        color: "#E8EDF2",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        paddingBottom: 80,
      }}
    >
      {needReauth && <AuthPopup onAuthenticated={() => setNeedReauth(false)} />}

      <AppHeader
        username={username}
        onAvatarClick={() => setNeedReauth(true)}
      />
      <main style={{ width: "100%", padding: "8px 12px" }}>
        {error && (
          <div className="rounded-xl border border-[#ff8f8f66] bg-[#2a1111bf] px-3 py-2 text-xs sm:text-sm text-[#ffb8b8]">
            {error}
          </div>
        )}

        {addMarketFeedback && (
          <div className="mt-2 rounded-xl border border-[#7ef5c655] bg-[#0f2f27bf] px-3 py-2 text-xs sm:text-sm text-[#c8ffef]">
            {addMarketFeedback}
          </div>
        )}

        <div className="mx-auto w-full max-w-4xl">
          {isLoading ? (
            <div className="rounded-2xl border border-[#85f2cf24] bg-[#122120d4] p-7 text-center">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#70f0c2] border-r-transparent" />
              <p className="mt-2 text-xs sm:text-sm text-[#9ccbc5]">
                Loading map and nearby supermarkets...
              </p>
            </div>
          ) : (
            <div className="w-full rounded-2xl border border-[#82e9d333] bg-[#0f1d1cbf] p-0 shadow-[0_8px_24px_rgba(0,0,0,0.24)]">
              <Map
                key={`${userPos.lat}-${userPos.lon}`}
                height="65vh"
                zoom={12}
                centerPos={userPos}
                markedPositions={markedPositions}
              />
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            <button
              onClick={() => setShowRadiusControls((prev) => !prev)}
              className="rounded-full border border-[#7ef5c655] bg-[#132726] px-3 py-1.5 text-xs sm:text-sm text-[#d5fff5] hover:bg-[#1a3432] transition-colors"
            >
              {showRadiusControls
                ? "Hide radius"
                : `Adjust radius (${formatMeters(supermarketRadius)})`}
            </button>
            <button
              onClick={() => {
                setAddMarketFeedback(null);
                setAddSupermarketIsActive(true);
              }}
              className="rounded-full border border-[#7ef5c655] bg-[#132726] px-3 py-1.5 text-xs sm:text-sm text-[#d5fff5] hover:bg-[#1a3432] transition-colors"
            >
              Add supermarket
            </button>
          </div>

          {showRadiusControls && (
            <section className="mx-auto mt-3 w-full max-w-sm rounded-xl border border-[#7ef5c640] bg-[linear-gradient(135deg,#112322,#1d1614)] px-3 py-3 sm:px-4">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="radius-slider"
                  className="text-xs uppercase tracking-[0.2em] text-[#8cb5b0]"
                >
                  Radius
                </label>
                <button
                  onClick={() => setSupermarketRadius(3000)}
                  className="rounded-full border border-[#90f4d855] bg-[#142826] px-3 py-1 text-xs text-[#c4f7eb] hover:bg-[#1a3533] transition-colors"
                >
                  Default
                </button>
              </div>
              <input
                id="radius-slider"
                type="range"
                min={500}
                max={10000}
                step={250}
                value={supermarketRadius}
                onChange={(event) =>
                  setSupermarketRadius(Number(event.target.value))
                }
                className="mt-2 w-full accent-[#7ef5c6]"
              />
              <div className="mt-1 flex justify-between text-[11px] text-[#789694]">
                <span>500 m</span>
                <span>10 km</span>
              </div>
            </section>
          )}
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
    </div>
  );
};

export default memo(GeoSupermarketSite);
