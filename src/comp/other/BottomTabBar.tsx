import { memo } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const TEAL = "#1D9E75";
const MUTED = "#4A5568";

const HomeIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? TEAL : MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const ListIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? TEAL : MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const ScanIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? TEAL : MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);

const HeartIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? TEAL : "none"} stroke={active ? TEAL : MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

const MapIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? TEAL : MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const PlannerIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? TEAL : MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="14" x2="8.01" y2="14" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="12" y1="14" x2="12.01" y2="14" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="16" y1="14" x2="16.01" y2="14" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="8" y1="18" x2="8.01" y2="18" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const RecipeIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? TEAL : MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
  </svg>
);

const tabs = [
  { href: "/dashboard",       label: "Home",    Icon: HomeIcon    },
  { href: "/planner",         label: "Planer",  Icon: PlannerIcon },
  { href: "/recipes",         label: "Recipes", Icon: RecipeIcon  },
  { href: "/scanner",         label: "Scan",    Icon: ScanIcon    },
  { href: "/market_mapping",  label: "Stores",  Icon: MapIcon     },
] as const;

const BottomTabBar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "#0D1117",
        borderTop: "1px solid #21262D",
        display: "flex",
        padding: "8px 0 16px",
        zIndex: 100,
      }}
    >
      {tabs.map((tab) => {
        const active = location.pathname === tab.href ||
          // treat /scanner/manual as "Scan" active
          (tab.href === "/scanner" && location.pathname.startsWith("/scanner"));
        return (
          <button
            key={tab.href}
            onClick={() => navigate(tab.href)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
              border: "none",
              background: "none",
              color: active ? TEAL : MUTED,
              padding: "4px 0",
              transition: "color 0.15s",
              fontFamily: "'DM Sans', system-ui, sans-serif",
            }}
          >
            <tab.Icon active={active} />
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 500, letterSpacing: "0.01em" }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default memo(BottomTabBar);
