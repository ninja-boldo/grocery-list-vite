import { memo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

const HomeIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
const PlannerIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const ScanIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);
const MapIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const TABS = [
  {
    href: "/dashboard",
    labelKey: "home",
    labelDefault: "Home",
    Icon: HomeIcon,
  },
  {
    href: "/planner",
    labelKey: "planer",
    labelDefault: "Planner",
    Icon: PlannerIcon,
  },
  { href: "/scanner", labelKey: "scan", labelDefault: "Scan", Icon: ScanIcon },
  {
    href: "/market_mapping",
    labelKey: "stores",
    labelDefault: "Stores",
    Icon: MapIcon,
  },
] as const;

const BottomTabBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <nav className="bottom-tab-bar">
      {TABS.map((tab) => {
        const active =
          location.pathname === tab.href ||
          (tab.href === "/scanner" && location.pathname.startsWith("/scanner"));
        return (
          <button
            key={tab.href}
            className={`bottom-tab-bar__tab${active ? " bottom-tab-bar__tab--active" : ""}`}
            onClick={() => navigate(tab.href)}
          >
            {active && <span className="bottom-tab-bar__tab-indicator" />}
            <tab.Icon />
            <span className="bottom-tab-bar__label">
              {t(tab.labelKey, tab.labelDefault)}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default memo(BottomTabBar);
