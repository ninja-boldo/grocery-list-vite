import { memo } from "react";
import { useTranslation } from "react-i18next";

interface SidebarCompProps {
  isOpen: boolean;
  onClose: () => void;
  setNeedReauth?: (value: boolean) => void;
}

const NAV_ITEMS = [
  {
    href: "/",
    labelKey: "itemList",
    labelDefault: "Item List",
    path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  },
  {
    href: "/wish_list",
    labelKey: "wishList",
    labelDefault: "Wish List",
    path: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
  },
  {
    href: "/market_mapping",
    labelKey: "supermarkets",
    labelDefault: "Supermarkets",
    path: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    href: "/settings",
    labelKey: "settings",
    labelDefault: "Settings",
    path: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    href: "/attribution",
    labelKey: "attribution",
    labelDefault: "Attribution",
    path: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
] as const;

const SidebarComp = ({ isOpen, onClose, setNeedReauth }: SidebarCompProps) => {
  const { t } = useTranslation();
  const currentPath = window.location.pathname;

  return (
    <>
      <div
        className={`sidebar-backdrop${isOpen ? " sidebar-backdrop--open" : " sidebar-backdrop--closed"}`}
        onClick={onClose}
      />
      <div
        className={`sidebar-panel${isOpen ? " sidebar-panel--open" : " sidebar-panel--closed"}`}
      >
        <div className="sidebar__header">
          <div className="sidebar__logo">
            <span>🛒</span> Groceries
          </div>
          <button className="sidebar__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="sidebar__section-label">
          {t("navigation", "Navigation")}
        </div>

        <nav className="sidebar__nav">
          {NAV_ITEMS.map(({ href, labelKey, labelDefault, path }) => {
            const active = currentPath === href;
            return (
              <a
                key={href}
                href={href}
                className={`sidebar__nav-item${active ? " sidebar__nav-item--active" : ""}`}
              >
                <div className="sidebar__nav-icon">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={active ? "var(--accent)" : "var(--text-dim)"}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={path} />
                  </svg>
                </div>
                <span style={{ flex: 1 }}>{t(labelKey, labelDefault)}</span>
                {active && <span className="sidebar__active-dot" />}
              </a>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <button
            className="sidebar__avatar"
            onClick={() => setNeedReauth?.(true)}
            title={t("account", "Account")}
          >
            {localStorage.getItem("username")?.[0] ?? "U"}
          </button>
          <div className="sidebar__version">
            <span className="sidebar__version-dot" />
            v1.0
          </div>
        </div>
      </div>
    </>
  );
};

export default memo(SidebarComp);
