import { Routes, Route, Navigate } from "react-router-dom";
import React, { Suspense } from "react";
import App from "./App";
import AttributionPage from "./sites/Attribution";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

const Dashboard = React.lazy(() => import("./sites/Dashboard"));
const WishList = React.lazy(() => import("./sites/WishList"));
const ManualAdd = React.lazy(() => import("./comp/scanning/ManualAdding"));
const GeoSupermarkets = React.lazy(() => import("./sites/GeoSupermarkets"));
const ImprovedScanner = React.lazy(
  () => import("./comp/scanning/ImprovedScanner"),
);
const SettingsPage = React.lazy(() => import("./sites/Settings"));
const MealPlanner = React.lazy(() => import("./sites/MealPlanner"));
const RecipesPage = React.lazy(() => import("./sites/Recipes"));

const PageLoader = ({ t }: { t: TFunction }) => (
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
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 14,
        border: "1px solid #21262D",
        background: "#161B22",
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: "#1D9E75",
          boxShadow: "0 0 0 6px rgba(29, 158, 117, 0.2)",
        }}
      />
      {t("LoadingPantry", "Loading pantry")}
    </div>
  </div>
);

export default function AppRouter() {
  const { t } = useTranslation();

  return (
    <Suspense fallback={<PageLoader t={t} />}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/items" element={<App />} />
        <Route path="/wish_list" element={<WishList />} />
        <Route path="/scanner/manual" element={<ManualAdd />} />
        <Route path="/market_mapping" element={<GeoSupermarkets />} />
        <Route path="/scanner" element={<ImprovedScanner />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/planner" element={<MealPlanner />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/attribution" element={<AttributionPage />} />
      </Routes>
    </Suspense>
  );
}
