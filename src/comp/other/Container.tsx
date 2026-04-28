import { useEffect, useRef, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import Badge, { BadgeType } from "./Badge";
import CountPill from "./ContainerComp/CountPill";
import AttributionNotice from "../utils/AttributionNotice";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../ctx/ThemeContext";

export interface ContainerProps {
  text: string | null;
  subgroups?: string | null;
  shortened_name: string | null;
  style?: string;
  count: number;
  classname: string | null;
  perish_dates: string[] | null;
  imageUrl: string;
  tags: string | string[] | null;
  ean: string;
  isWishedNumber: number | null;
  /** Wish-list only: inventory items matched to this entry */
  mapped_items?: { count: number; item_name: string }[];
  /** Days until expiry, or null/-1 if unknown */
  expiryDays?: number | null;
  onClickIncrease: (clickedNode: ContainerProps) => Promise<void>;
  onClickDecrease: (clickedNode: ContainerProps) => Promise<void>;
}

const parseArr = (value: string | string[] | null): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p : [];
  } catch {
    const t = value.trim();
    if (t.startsWith("[") && t.endsWith("]")) return [];
    return t
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^"/, "").replace(/"$/, ""))
      .filter(Boolean);
  }
};

const Container = ({
  text,
  shortened_name,
  style,
  count,
  classname,
  perish_dates,
  imageUrl,
  tags,
  ean,
  isWishedNumber,
  mapped_items,
  expiryDays,
  onClickIncrease,
  onClickDecrease,
}: ContainerProps) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const checkedTags: string[] = parseArr(tags);

  const [open, setOpen] = useState(false);
  const [isIncreasing, setIsIncreasing] = useState(false);
  const [isDecreasing, setIsDecreasing] = useState(false);
  const divRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (divRef.current && !divRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const dates = parseArr(perish_dates);
  const hasValidDates = dates.length > 0 && dates[0] !== "none";
  const displayName =
    shortened_name && shortened_name !== "none" ? shortened_name : text;
  const eanDisplay = ["", "0", "-1", "1", "none"].includes(ean) ? null : ean;
  const mappedInventoryCount =
    mapped_items?.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const countPillInStockNumber =
    isWishedNumber !== null ? mappedInventoryCount : count;

  const handleInc = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsIncreasing(true);
    try {
      await onClickIncrease({
        text,
        shortened_name,
        style,
        count,
        classname,
        perish_dates,
        imageUrl,
        tags: checkedTags,
        ean,
        isWishedNumber,
        mapped_items,
        onClickIncrease,
        onClickDecrease,
      });
    } finally {
      setTimeout(() => setIsIncreasing(false), 300);
    }
  };
  const handleDec = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDecreasing(true);
    try {
      await onClickDecrease({
        text,
        shortened_name,
        style,
        count,
        classname,
        perish_dates,
        imageUrl,
        tags: checkedTags,
        ean,
        isWishedNumber,
        mapped_items,
        onClickIncrease,
        onClickDecrease,
      });
    } finally {
      setTimeout(() => setIsDecreasing(false), 300);
    }
  };

  // Memoize button style per theme to prevent recreation
  const btnStyle = useMemo(() => {
    return (
      active: boolean,
      activeColor: "accent" | "red",
    ): React.CSSProperties => ({
      width: 28,
      height: 28,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      border: `1px solid ${active ? (activeColor === "accent" ? "var(--accent-glow)" : "var(--error-bg)") : "var(--border-soft)"}`,
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 16,
      lineHeight: "1",
      fontWeight: 300,
      backgroundColor: active
        ? activeColor === "accent"
          ? "var(--accent-light)"
          : "var(--error-bg)"
        : "var(--surface-1)",
      color: active
        ? activeColor === "accent"
          ? "var(--success)"
          : "var(--error)"
        : "var(--text-muted)",
      transition: "all 0.15s",
    });
  }, [theme]);

  return (
    <div className={cn("px-3 m-2", style)}>
      <div
        ref={divRef}
        style={{
          background: "var(--surface)",
          border: `1px solid ${open ? "var(--accent-border)" : "var(--border-soft)"}`,
          borderRadius: 18,
          boxShadow: open
            ? `0 0 0 1px var(--accent-glow), 0 12px 34px rgba(0, 0, 0, 0.32)`
            : "0 8px 20px rgba(0, 0, 0, 0.2)",
          transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
          overflow: "hidden",
        }}
      >
        {/* ── Main row ──────────────────────────────── */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => e.key === "Enter" && setOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "11px 12px",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          {/* Accent bar */}
          <div
            style={{
              width: 2,
              alignSelf: "stretch",
              borderRadius: 4,
              flexShrink: 0,
              backgroundColor: open
                ? "var(--accent-primary)"
                : "var(--border-soft)",
              transition: "background-color 0.2s",
            }}
          />

          {/* Name */}
          <p
            style={{
              flex: 1,
              minWidth: 0,
              marginLeft: 4,
              fontSize: 14,
              fontWeight: 500,
              color: "var(--text-main)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              margin: "0 0 0 4px",
            }}
          >
            {displayName}
          </p>

          {/* Count pill */}
          <CountPill
            instockNumber={countPillInStockNumber}
            wishedNumber={isWishedNumber}
            isIncreasing={isIncreasing}
            isDecreasing={isDecreasing}
            TEAL="var(--accent-primary)"
            TEAL_B="var(--accent-glow)"
            TEAL_D={
              theme === "dark" ? "var(--accent-light)" : "rgba(44,66,52,0.8)"
            }
          />

          {/* Buttons */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: "flex", gap: 5, flexShrink: 0 }}
          >
            <button
              onClick={handleDec}
              disabled={isDecreasing}
              aria-label={t("Decrease", "Decrease")}
              style={btnStyle(!!isDecreasing, "red")}
            >
              -
            </button>
            <button
              onClick={handleInc}
              disabled={isIncreasing}
              aria-label={t("Increase", "Increase")}
              style={btnStyle(!!isIncreasing, "accent")}
            >
              +
            </button>
          </div>

          {/* Chevron */}
          <div
            style={{
              flexShrink: 0,
              width: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.25s",
              color: open ? "var(--accent-primary)" : "var(--text-dim)",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        {/* ── Expandable panel ──────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: open ? "1fr" : "0fr",
            transition: "grid-template-rows 0.28s cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          <div style={{ overflow: "hidden" }}>
            <div
              style={{
                margin: "0 12px",
                height: 1,
                backgroundColor: "var(--border-soft)",
              }}
            />

            {hasValidDates ? (
              <div style={{ padding: 12 }}>
                {/* Product header */}
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginBottom: 12,
                    alignItems: "flex-start",
                  }}
                >
                  {/* Thumbnail */}
                  <div
                    style={{
                      flexShrink: 0,
                      width: 80,
                      height: 80,
                      borderRadius: 12,
                      backgroundColor: "var(--surface-0)",
                      border: `1px solid var(--border-soft)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      padding: 3,
                    }}
                  >
                    {open && (
                      <img
                        src={imageUrl}
                        loading="lazy"
                        decoding="async"
                        alt={t(
                          "imageWithUrlImageurl",
                          "image with url: {{imageUrl}}",
                          { imageUrl },
                        )}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          borderRadius: 8,
                        }}
                      />
                    )}
                  </div>

                  {/* Info — name, EAN on same row, then badge */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      paddingTop: 3,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    {/* Row 1: name */}
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text-main)",
                        lineHeight: 1.35,
                        margin: 0,
                      }}
                    >
                      {text}
                    </p>

                    {/* Row 2: EAN badge + number, same visual weight as name row */}
                    {eanDisplay && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          margin: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.07em",
                            textTransform: "uppercase",
                            color: "var(--text-muted)",
                            padding: "1px 5px",
                            border: `1px solid var(--border-soft)`,
                            borderRadius: 4,
                            backgroundColor: "var(--surface-1)",
                            lineHeight: "16px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t("EAN", "EAN")}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontFamily: "monospace",
                            color: "var(--text-subtle)",
                            letterSpacing: "0.02em",
                            lineHeight: "16px", // match badge height exactly
                          }}
                        >
                          {eanDisplay}
                        </span>

                        <AttributionNotice compact />
                      </div>
                    )}
                  </div>
                </div>

                {/* badge row */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    marginTop: 12,
                    marginBottom: 8,
                  }}
                >
                  {/* date count badge */}
                  <Badge
                    text_or_dates={dates}
                    type={BadgeType.DateBadge}
                    Color_1={"var(--accent)"}
                    Color_2={
                      theme === "dark" ? "var(--accent-glow)" : "var(--accent)"
                    }
                    expiryDaysOverride={expiryDays}
                  />
                  {checkedTags.map((text, idx) => (
                    <Badge
                      key={idx}
                      text_or_dates={text}
                      type={BadgeType.TextBadge}
                      Color_1={"var(--accent)"}
                      Color_2={
                        theme === "dark"
                          ? "var(--accent-glow)"
                          : "var(--accent)"
                      }
                    />
                  ))}
                </div>

                {/* Date rows */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    maxHeight: 220,
                    overflowY: "auto",
                    scrollbarWidth: "thin",
                    scrollbarColor: `var(--border-soft) transparent`,
                  }}
                >
                  {dates.map((d, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 12px",
                        borderRadius: 10,
                        backgroundColor: "var(--surface-1)",
                        border: `1px solid var(--border-soft)`,
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.borderColor =
                          "var(--accent-glow)")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.borderColor =
                          "var(--border-soft)")
                      }
                    >
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          backgroundColor: "var(--accent)",
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 13,
                          fontFamily: "monospace",
                          color: "var(--text-dim)",
                          fontWeight: 500,
                        }}
                      >
                        {d}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "8px 12px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: "var(--error)",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "var(--text-muted)",
                  }}
                >
                  {t("noValidDatesCode42", "No valid dates (code 42)")}
                </span>
              </div>
            )}

            {/* ── Mapped inventory items (wish-list only) ── */}
            {mapped_items && mapped_items.length > 0 && (
              <div
                style={{
                  margin: "0 12px 12px",
                  padding: "9px 11px",
                  backgroundColor:
                    theme === "dark"
                      ? "var(--accent-light)"
                      : "var(--accent-glow)",
                  border: `1px solid ${theme === "dark" ? "var(--accent-glow)" : "var(--accent-border)"}`,
                  borderRadius: 10,
                }}
              >
                {/* Header row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    marginBottom: 7,
                  }}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={
                      theme === "dark" ? "var(--accent)" : "var(--surface)"
                    }
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--accent-text)",
                    }}
                  >
                    {t("inInventory", "In Inventory")}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: "var(--text-muted)",
                    }}
                  >
                    {mapped_items.reduce((s, m) => s + m.count, 0)}{" "}
                    {t("total", "total")}
                  </span>
                </div>

                {/* Item pills */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {mapped_items.map((m, i) => (
                    <div
                      key={i}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 8px",
                        borderRadius: 20,
                        backgroundColor: "var(--surface-1)",
                        border: `1px solid ${theme === "dark" ? "var(--accent-glow)" : "var(--accent-border)"}`,
                        fontSize: 12,
                        color: "var(--text-dim)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{m.item_name}</span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--accent)",
                          fontWeight: 600,
                        }}
                      >
                        {t("count2", "×{{count}}", { count: m.count })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Container;
