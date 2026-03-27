import { Routes, Route } from "react-router-dom";
import React, { Suspense } from "react";
import App from "./App";
import AttributionPage from "./sites/Attribution";

const WishList = React.lazy(() => import("./sites/WishList"));
const ManualAdd = React.lazy(() => import("./comp/scanning/ManualAdding"));
const GeoSupermarkets = React.lazy(() => import("./sites/GeoSupermarkets"));
const ImprovedScanner = React.lazy(
  () => import("./comp/scanning/ImprovedScanner"),
);
const SettingsPage = React.lazy(() => import("./sites/Settings"));

const PageLoader = () => (
  <div
    style={{
      minHeight: "100dvh",
      display: "grid",
      placeItems: "center",
      background: "#0D1117",
      color: "#d9f8f0",
      fontSize: "14px",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}
  >
    Loading...
  </div>
);

export default function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/wish_list" element={<WishList />} />
        <Route path="/scanner/manual" element={<ManualAdd />} />
        <Route path="/market_mapping" element={<GeoSupermarkets />} />
        <Route path="/scanner" element={<ImprovedScanner />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/attribution" element={<AttributionPage />} />
      </Routes>
    </Suspense>
  );
}
