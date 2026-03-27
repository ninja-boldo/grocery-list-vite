import { memo } from "react";
import { useLocation } from "react-router-dom";

const TEAL = "#1D9E75";

const pageInfo: Record<string, { title: (username: string) => string; sub: string }> = {
  "/": {
    title: (username) => {
      const firstLetter = username.charAt(0);
      username = username.replace(firstLetter, firstLetter.toUpperCase());
      
      const hour = new Date().getHours();
      const greeting =
        hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
      return `${greeting}, ${username}`;
    },
    sub: "Here's your pantry overview",
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
  "/attribution": {
    title: () => "Attribution",
    sub: "Open source credits",
  },
};

interface AppHeaderProps {
  username?: string;
  onAvatarClick?: () => void;
}

const AppHeader = ({ username = "L", onAvatarClick }: AppHeaderProps) => {
  const location = useLocation();
  const info = pageInfo[location.pathname] ?? {
    title: () => "Groceries",
    sub: "",
  };

  const displayInitial = username.charAt(0).toUpperCase();
  const title = info.title(username);

  return (
    <div
      style={{
        padding: "20px 20px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#E8EDF2",
            letterSpacing: "-0.3px",
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 13, color: "#6B7A8A", marginTop: 3 }}>
          {info.sub}
        </div>
      </div>
      <button
        onClick={onAvatarClick}
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: TEAL,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          fontFamily: "'DM Sans', system-ui, sans-serif",
          boxShadow: `0 2px 12px ${TEAL}55`,
        }}
      >
        {displayInitial}
      </button>
    </div>
  );
};

export default memo(AppHeader);
