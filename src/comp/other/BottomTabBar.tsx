import { memo } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const HomeIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
const ScanIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);
const MapIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);
const PlannerIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const tabs = [
  { href: "/dashboard",      label: "Home",   Icon: HomeIcon    },
  { href: "/planner",        label: "Planer", Icon: PlannerIcon },
  { href: "/scanner",        label: "Scan",   Icon: ScanIcon    },
  { href: "/market_mapping", label: "Stores", Icon: MapIcon     },
] as const;

const BottomTabBar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "var(--surface)",
      borderTop: "1px solid var(--border)",
      display: "flex",
      padding: "8px 0 env(safe-area-inset-bottom, 12px)",
      zIndex: 100,
      boxShadow: "0 -4px 16px rgba(28,26,22,0.07)",
    }}>
      {tabs.map((tab) => {
        const active = location.pathname === tab.href ||
          (tab.href === "/scanner" && location.pathname.startsWith("/scanner"));
        return (
          <button
            key={tab.href}
            onClick={() => navigate(tab.href)}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              cursor: "pointer", border: "none", background: "none",
              color: active ? "var(--accent)" : "var(--text-dim)",
              padding: "4px 0", transition: "color 0.15s",
              fontFamily: "var(--font-body)",
              position: "relative",
            }}
          >
            {active && (
              <span style={{
                position: "absolute",
                top: -1,
                width: 24,
                height: 2,
                borderRadius: 2,
                background: "var(--accent)",
              }} />
            )}
            <tab.Icon active={active} />
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 500 }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default memo(BottomTabBar);
