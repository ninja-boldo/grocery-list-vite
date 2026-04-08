import { Routes, Route, Navigate } from "react-router-dom";
import React, { Suspense } from "react";
import App from "./App";
import AttributionPage from "./sites/Attribution";

const Dashboard = React.lazy(() => import("./sites/Dashboard"));
const WishList = React.lazy(() => import("./sites/WishList"));
const ManualAdd = React.lazy(() => import("./comp/scanning/ManualAdding"));
const GeoSupermarkets = React.lazy(() => import("./sites/GeoSupermarkets"));
const ImprovedScanner = React.lazy(
  () => import("./comp/scanning/ImprovedScanner"),
);
const SettingsPage = React.lazy(() => import("./sites/Settings"));
const MealPlanner  = React.lazy(() => import("./sites/MealPlanner"));

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
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/items" element={<App />} />
        <Route path="/wish_list" element={<WishList />} />
        <Route path="/scanner/manual" element={<ManualAdd />} />
        <Route path="/market_mapping" element={<GeoSupermarkets />} />
        <Route path="/scanner" element={<ImprovedScanner />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/planner"     element={<MealPlanner />} />
        <Route path="/attribution" element={<AttributionPage />} />
      </Routes>
    </Suspense>
  );
}
