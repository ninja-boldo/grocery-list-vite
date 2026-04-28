import { memo, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18next from "i18next";

const pageInfo: Record<string, { title: (u: string) => string; sub: string }> =
  {
    "/dashboard": {
      title: (u) => {
        const h = new Date().getHours();
        const g =
          h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
        return i18next.t("gU", "{{g}}, {{u}}", { g, u });
      },
      sub: i18next.t("heresYourPantryOverview", "Here's your pantry overview"),
    },
    "/items": {
      title: () => i18next.t("myPantry", "myPantry"),
      sub: i18next.t("yourInventory", "Your inventory"),
    },
    "/wish_list": {
      title: () => i18next.t("wishList", "Wish List"),
      sub: i18next.t("itemsYouWantToBuy", "Items you want to buy"),
    },
    "/market_mapping": {
      title: () => "Nearby Stores",
      sub: i18next.t("yourSavedSupermarkets", "Your saved supermarkets"),
    },
    "/settings": {
      title: () => "Settings",
      sub: i18next.t("accountPreferences", "Account & preferences"),
    },
    "/recipes": {
      title: () => "Recipes",
      sub: i18next.t("cookFromYourPantry", "Cook from your pantry"),
    },
    "/attribution": {
      title: () => "Attribution",
      sub: i18next.t("openSourceCredits", "Open source credits"),
    },
    "/planner": {
      title: () => "Meal Planner",
      sub: i18next.t("planYourWeek", "Plan your week"),
    },
  };

interface AppHeaderProps {
  username?: string;
}

const AppHeader = ({ username = "U" }: AppHeaderProps) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const info = pageInfo[location.pathname] ?? {
    title: () => "Groceries",
    sub: "",
  };
  const displayInitial = username.charAt(0).toUpperCase();
  const title = info.title(username);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      )
        setDropdownOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => setDropdownOpen(false), [location.pathname]);

  const handleSignOut = () => {
    localStorage.removeItem("jwt_auth");
    localStorage.removeItem("username");
    window.location.href = "/";
  };

  const menuItems = [
    {
      label: t("settings", "Settings"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
      onClick: () => navigate("/settings"),
    },
    {
      label: t("attribution", "Attribution"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      ),
      onClick: () => navigate("/attribution"),
    },
    { label: "divider", icon: null, onClick: () => {} },
    {
      label: t("signOut2", "Sign Out"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
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
        margin: "10px 10px 8px",
        padding: "14px 16px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 20,
            fontWeight: 600,
            color: "var(--text-main)",
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
          {info.sub}
        </div>
      </div>

      <div ref={dropdownRef} style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: dropdownOpen ? "var(--accent-light)" : "var(--accent)",
            color: dropdownOpen ? "var(--accent-text)" : "#fff",
            border: `2px solid ${dropdownOpen ? "var(--accent-border)" : "transparent"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            transition: "all 0.15s",
            boxShadow: "0 2px 8px rgba(74,124,89,0.25)",
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
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              boxShadow: "var(--shadow-lg)",
              minWidth: 168,
              zIndex: 200,
              overflow: "hidden",
              padding: "4px 0",
            }}
          >
            <div
              style={{
                padding: "10px 14px 8px",
                borderBottom: "1px solid var(--border)",
                marginBottom: 2,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-main)",
                }}
              >
                {username}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {t("signedIn", "Signed in")}
              </div>
            </div>
            {menuItems.map((item, i) => {
              if (item.label === "divider")
                return (
                  <div
                    key={i}
                    style={{
                      height: 1,
                      background: "var(--border)",
                      margin: "4px 0",
                    }}
                  />
                );
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
                    color: (item as { danger?: boolean }).danger
                      ? "var(--error)"
                      : "var(--text-main)",
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = (
                      item as { danger?: boolean }
                    ).danger
                      ? "var(--error-bg)"
                      : "var(--surface-2)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      "transparent";
                  }}
                >
                  <span
                    style={{
                      color: (item as { danger?: boolean }).danger
                        ? "var(--error)"
                        : "var(--text-dim)",
                      flexShrink: 0,
                    }}
                  >
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
