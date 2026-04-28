import { memo, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/ctx/ThemeContext";

interface AppHeaderProps {
  username?: string;
}

const SunIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);
const MoonIcon = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const AppHeader = ({ username = "U" }: AppHeaderProps) => {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const pageInfo: Record<
    string,
    { title: (u: string) => string; sub: string }
  > = {
    "/dashboard": {
      title: (u) => {
        const h = new Date().getHours();
        const g =
          h < 12
            ? t("GoodMorning", "Good morning")
            : h < 17
              ? t("GoodAfternoon", "Good afternoon")
              : t("GoodEvening", "Good evening");
        return t("gU", "{{g}}, {{u}}", { g, u });
      },
      sub: t("heresYourPantryOverview", "Here's your pantry overview"),
    },
    "/items": {
      title: () => t("myInventory", "My Inventory"),
      sub: t("yourInventory", "Your inventory"),
    },
    "/wish_list": {
      title: () => t("wishList", "Wish List"),
      sub: t("itemsYouWantToBuy", "Items you want to buy"),
    },
    "/market_mapping": {
      title: () => t("nearbyStores", "Nearby Stores"),
      sub: t("yourSavedSupermarkets", "Your saved supermarkets"),
    },
    "/settings": {
      title: () => t("settings", "Settings"),
      sub: t("accountPreferences", "Account & preferences"),
    },
    "/recipes": {
      title: () => t("recipes", "Recipes"),
      sub: t("cookFromYourPantry", "Cook from your pantry"),
    },
    "/attribution": {
      title: () => t("attribution", "Attribution"),
      sub: t("openSourceCredits", "Open source credits"),
    },
    "/planner": {
      title: () => t("mealPlanner", "Meal Planner"),
      sub: t("planYourWeek", "Plan your week"),
    },
  };

  const info = pageInfo[location.pathname] ?? {
    title: () => "Groceries",
    sub: "",
  };
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
      icon: "⚙️",
      onClick: () => navigate("/settings"),
    },
    {
      label: t("attribution", "Attribution"),
      icon: "ℹ️",
      onClick: () => navigate("/attribution"),
    },
    { divider: true },
    {
      label: t("signOut2", "Sign Out"),
      icon: "→",
      onClick: handleSignOut,
      danger: true,
    },
  ];

  return (
    <div className="app-header">
      <div>
        <div className="app-header__title">{title}</div>
        <div className="app-header__sub">{info.sub}</div>
      </div>

      <div className="app-header__actions">
        <button
          className="theme-toggle"
          onClick={toggle}
          title={
            theme === "dark"
              ? t("lightMode", "Light mode")
              : t("darkMode", "Dark mode")
          }
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>

        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            className={`app-header__avatar${dropdownOpen ? " app-header__avatar--open" : ""}`}
            onClick={() => setDropdownOpen((v) => !v)}
          >
            {username.charAt(0).toUpperCase()}
          </button>

          {dropdownOpen && (
            <div className="dropdown-menu">
              <div className="dropdown-menu__header">
                <div className="dropdown-menu__name">{username}</div>
                <div className="dropdown-menu__status">
                  {t("signedIn", "Signed in")}
                </div>
              </div>
              {menuItems.map((item, i) =>
                (item as { divider?: boolean }).divider ? (
                  <div key={i} className="dropdown-menu__divider" />
                ) : (
                  <button
                    key={item.label}
                    className={`dropdown-menu__item${(item as { danger?: boolean }).danger ? " dropdown-menu__item--danger" : ""}`}
                    onClick={item.onClick}
                  >
                    <span className="dropdown-menu__item-icon">
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(AppHeader);
