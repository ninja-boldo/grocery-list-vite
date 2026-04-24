import { memo } from "react";
import type { Item } from "@/App";
import { PageModes } from "@/lib/utils";

interface TopBarProps {
  sidebarOpen?: boolean;
  onSidebarToggle?: () => void;
  classNames?: string[];
  selectedClass?: string | null;
  onFilter?: (cls: string | null) => void;
  onReset?: () => void;
  onScanIncrease?: () => void;
  onScanDecrease?: () => void;
  items?: Item[];
  setItems?: (items: Item[]) => void;
  currentSortOrder?: string;
  mode?: PageModes;
  floating?: boolean;
}

const TopBar = ({
  onReset,
  onScanIncrease,
  mode,
}: TopBarProps) => {
  const isWish = mode === PageModes.WishPage;

  return (
    <div style={{
      padding: "6px 12px 8px",
      display: "flex",
      gap: 8,
      alignItems: "center",
    }}>
      {onScanIncrease && (
        <button
          onClick={onScanIncrease}
          style={{
            flex: 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "10px 14px", borderRadius: 12,
            background: "var(--accent)", color: "#fff",
            border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
            boxShadow: "0 2px 8px rgba(74,124,89,0.25)",
            transition: "background 0.15s",
            fontFamily: "var(--font-body)",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--accent-hover)")}
          onMouseLeave={e => (e.currentTarget.style.background = "var(--accent)")}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {isWish ? "Add to wish list" : "Scan item"}
        </button>
      )}
      {onReset && (
        <button
          onClick={onReset}
          title="Refresh"
          style={{
            width: 38, height: 38, borderRadius: 10,
            background: "var(--surface)", border: "1px solid var(--border)",
            color: "var(--text-muted)", cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", flexShrink: 0,
            transition: "all 0.12s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLElement).style.color = "var(--text-main)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-3" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default memo(TopBar);
