import { memo } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const TEAL = "#1D9E75";
const MUTED = "#4A5568";

const ListIcon = ({ active }: { active: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke={active ? TEAL : MUTED}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const HeartIcon = ({ active }: { active: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill={active ? TEAL : "none"}
    stroke={active ? TEAL : MUTED}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

const MapIcon = ({ active }: { active: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke={active ? TEAL : MUTED}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const GearIcon = ({ active }: { active: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke={active ? TEAL : MUTED}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const InfoIcon = ({ active }: { active: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke={active ? TEAL : MUTED}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* outer circle */}
    <circle cx="12" cy="12" r="9" />

    {/* dot */}
    <circle cx="12" cy="8" r="1" />

    {/* vertical line */}
    <path d="M12 11v5" />
  </svg>
);

const tabs = [
  {
    href: "/",
    label: "Items",
    Icon: ListIcon,
  },
  {
    href: "/wish_list",
    label: "Wish List",
    Icon: HeartIcon,
  },
  {
    href: "/market_mapping",
    label: "Stores",
    Icon: MapIcon,
  },
  {
    href: "/settings",
    label: "Settings",
    Icon: GearIcon,
  },
  {
    href: "/attribution",
    label: "Attribution",
    Icon: InfoIcon,
  },
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
        const active = location.pathname === tab.href;
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
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 600 : 500,
                letterSpacing: "0.01em",
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default memo(BottomTabBar);
