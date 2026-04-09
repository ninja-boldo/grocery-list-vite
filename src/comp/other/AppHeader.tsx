import { memo, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const TEAL = "#1D9E75";
const P = {
  surface: "#161B22",
  border: "#21262D",
  text: "#E8EDF2",
  muted: "#6B7A8A",
  subtle: "#4A5568",
};

const pageInfo: Record<string, { title: (u: string) => string; sub: string }> = {
  "/dashboard": {
    title: (u) => {
      const h = new Date().getHours();
      const g = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
      return `${g}, ${u}.`;
    },
    sub: "Here's your pantry overview",
  },
  "/items": {
    title: () => "Item List",
    sub: "Your pantry inventory",
  },
  "/wish_list": {
    title: () => "Wish List",
    sub: "Items you want to buy",
  },
  "/market_mapping": {
    title: () => "Nearby Stores",
    sub: "Your saved supermarkets",
  },
  "/settings": {
    title: () => "Settings",
    sub: "Account & preferences",
  },
  "/recipes": {
    title: () => "Recipes",
    sub: "Cook from your pantry",
  },
  "/attribution": {
    title: () => "Attribution",
    sub: "Open source credits",
  },
};

interface AppHeaderProps {
  username?: string;
}

const AppHeader = ({ username = "L" }: AppHeaderProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const info = pageInfo[location.pathname] ?? { title: () => "Groceries", sub: "" };
  const displayInitial = username.charAt(0).toUpperCase();
  const title = info.title(displayInitial);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close dropdown on route change
  useEffect(() => {
    setDropdownOpen(false);
  }, [location.pathname]);

  const handleSignOut = () => {
    localStorage.removeItem("jwt_auth");
    localStorage.removeItem("username");
    setDropdownOpen(false);
    window.location.href = "/";
  };

  const menuItems = [
    {
      label: "Settings",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
      onClick: () => navigate("/settings"),
    },
    {
      label: "Attribution",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      ),
      onClick: () => navigate("/attribution"),
    },
    {
      label: "Recipes",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
        </svg>
      ),
      onClick: () => navigate("/recipes"),
    },
    { label: "divider", icon: null, onClick: () => {} },
    {
      label: "Sign Out",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      ),
      onClick: handleSignOut,
      danger: true,
    },
  ];

  return (
    <div
      style={{
        padding: "20px 20px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "relative",
      }}
    >
      {/* Title + subtitle */}
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: P.text, letterSpacing: "-0.3px", lineHeight: 1.2 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: P.muted, marginTop: 3 }}>{info.sub}</div>
      </div>

      {/* Avatar + dropdown */}
      <div ref={dropdownRef} style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: dropdownOpen ? "#0F6E56" : TEAL,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 700,
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontFamily: "'DM Sans', system-ui, sans-serif",
            boxShadow: `0 2px 12px ${TEAL}55`,
            transition: "background 0.15s",
          }}
        >
          {displayInitial}
        </button>

        {dropdownOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              background: P.surface,
              border: `1px solid ${P.border}`,
              borderRadius: 12,
              boxShadow: "0 8px 32px #00000070",
              minWidth: 160,
              zIndex: 200,
              overflow: "hidden",
              padding: "4px 0",
            }}
          >
            {/* Username header */}
            <div style={{ padding: "8px 14px 6px", borderBottom: `1px solid ${P.border}`, marginBottom: 2 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: P.text }}>{username}</div>
              <div style={{ fontSize: 11, color: P.muted }}>Logged in</div>
            </div>

            {menuItems.map((item, i) => {
              if (item.label === "divider") {
                return <div key={i} style={{ height: 1, background: P.border, margin: "4px 0" }} />;
              }
              return (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  style={{
                    all: "unset",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "9px 14px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: (item as { danger?: boolean }).danger ? "#f87171" : P.text,
                    cursor: "pointer",
                    transition: "background 0.12s",
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = (item as { danger?: boolean }).danger ? "#2a1111" : "#1c2128";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <span style={{ color: (item as { danger?: boolean }).danger ? "#f87171" : P.subtle, flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(AppHeader);
