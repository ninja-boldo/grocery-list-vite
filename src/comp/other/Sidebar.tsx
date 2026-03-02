import { memo } from "react";

interface SidebarCompProps {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { href: "/",              label: "Item List",         icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", dot: "#0d9488" },
  { href: "/wish_list",     label: "Wish List",         icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z", dot: "#3b82f6" },
  { href: "/market_mapping",label: "Supermarkets",      icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z", dot: "#f59e0b" },
  { href: "/settings",      label: "Settings",          icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z", dot: "#8b5cf6" },
] as const;

const SidebarComp = ({ isOpen, onClose }: SidebarCompProps) => {
  const currentPath = window.location.pathname;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          backgroundColor: "#00000060",
          backdropFilter: "blur(2px)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, left: 0,
        height: "100%", width: 240,
        zIndex: 50,
        backgroundColor: "#0d1117",
        borderRight: "1px solid #0d948840",
        boxShadow: isOpen ? "4px 0 32px #00000080, 1px 0 0 #0d948830" : "none",
        transform: isOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)",
        display: "flex", flexDirection: "column",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 16px 16px",
          borderBottom: "1px solid #21262d",
        }}>
        </div>

        {/* Nav label */}
        <div style={{ padding: "16px 16px 6px" }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4d5566" }}>
            Navigation
          </span>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: "0 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV_ITEMS.map(({ href, label, icon, dot }) => {
            const active = currentPath === href;
            return (
              <a
                key={href}
                href={href}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 10px",
                  borderRadius: 10,
                  textDecoration: "none",
                  backgroundColor: active ? "#0f2a28" : "transparent",
                  border: `1px solid ${active ? "#0d948840" : "transparent"}`,
                  color: active ? "#5eead4" : "#8b949e",
                  fontSize: 13, fontWeight: active ? 500 : 400,
                  transition: "all 0.15s",
                  position: "relative",
                }}
                onMouseEnter={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement;
                    el.style.backgroundColor = "#161b22";
                    el.style.color = "#e6edf3";
                    el.style.borderColor = "#21262d";
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    const el = e.currentTarget as HTMLElement;
                    el.style.backgroundColor = "transparent";
                    el.style.color = "#8b949e";
                    el.style.borderColor = "transparent";
                  }
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  backgroundColor: active ? "#0d948815" : "#161b22",
                  border: `1px solid ${active ? "#0d948830" : "#21262d"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke={active ? "#0d9488" : "#4d5566"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={icon}/>
                  </svg>
                </div>

                {/* Label */}
                <span style={{ flex: 1 }}>{label}</span>

                {/* Active dot */}
                {active && (
                  <div style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: dot, flexShrink: 0 }} />
                )}
              </a>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{
          padding: "12px 16px",
          borderTop: "1px solid #21262d",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: "#0d9488" }} />
          <span style={{ fontSize: 11, color: "#4d5566", fontFamily: "monospace" }}>v1.0</span>
        </div>
      </div>
    </>
  );
};

export default memo(SidebarComp);