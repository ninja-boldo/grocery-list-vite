import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import Badge, { BadgeType } from "./Badge";
import CountPill from "./ContainerComp/CountPill";
import AttributionNotice from "../utils/AttributionNotice";

interface Props {
  text: string | null;
  subgroups: string | null;
  style?: string;
  count: number;
  classname: string | null;
  perish_dates: string[] | null;
  imageUrl: string;
  tags: string | string[] | null;
  ean: string;
  isWishedNumber: number | null;
  onClickIncrease: (clickedNode: Props) => Promise<void>;
  onClickDecrease: (clickedNode: Props) => Promise<void>;
}

const Container = ({
  text,
  subgroups,
  style,
  count,
  classname,
  perish_dates,
  imageUrl,
  tags,
  ean,
  isWishedNumber,
  onClickIncrease,
  onClickDecrease,
}: Props) => {
  if (!tags) {
    tags = [];
  }
  if(!Array.isArray(tags)){
    tags = tags.split(",")
  }

  const checkedTags: string[] = tags;

  const [open, setOpen] = useState(false);
  const [isIncreasing, setIsIncreasing] = useState(false);
  const [isDecreasing, setIsDecreasing] = useState(false);
  const divRef = useRef<HTMLDivElement | null>(null);

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
        .replace(/^$$|$$$/g, "")
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    }
  };

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
  const displayName = classname && classname !== "none" ? classname : text;
  const eanDisplay = ["", "0", "-1", "1"].includes(ean) ? "none" : ean;

  const handleInc = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsIncreasing(true);
    try {
      await onClickIncrease({
        text,
        subgroups,
        style,
        count,
        classname,
        perish_dates,
        imageUrl,
        onClickIncrease,
        onClickDecrease,
        ean,
        tags: checkedTags,
        isWishedNumber,
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
        subgroups,
        style,
        count,
        classname,
        perish_dates,
        imageUrl,
        onClickIncrease,
        onClickDecrease,
        ean,
        tags: checkedTags,
        isWishedNumber,
      });
    } finally {
      setTimeout(() => setIsDecreasing(false), 300);
    }
  };

  const TEAL = "#0d9488";
  const TEAL_D = "#0f2a28";
  const TEAL_B = "#0d948850";
  const TEAL_C = "#1a2e2b";
  const SURFACE = "#0d1117";
  const CARD = "#161b22";
  const BORDER = "#21262d";

  // Shared inline button style factory
  const btnStyle = (
    active: boolean,
    activeColor: "teal" | "red",
  ): React.CSSProperties => ({
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    border: `1px solid ${active ? (activeColor === "teal" ? TEAL_B : "#f43f5e40") : BORDER}`,
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 16,
    lineHeight: "1",
    fontWeight: 300,
    backgroundColor: active
      ? activeColor === "teal"
        ? TEAL_D
        : "#4c0519"
      : CARD,
    color: active
      ? activeColor === "teal"
        ? "#2dd4bf"
        : "#fb7185"
      : "#6e7681",
    transition: "all 0.15s",
  });

  return (
    <div className={cn("px-3 m-2", style)}>
      <div
        ref={divRef}
        style={{
          backgroundColor: SURFACE,
          border: `1px ridge ${open ? TEAL_C : "#1a2e2b"}`,
          borderRadius: 18,
          boxShadow: open
            ? `0 0 0 1px ${TEAL}22, 0 8px 32px ${TEAL}0e`
            : "none",
          transition: "border-color 0.2s, box-shadow 0.2s",
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
              backgroundColor: open ? TEAL : BORDER,
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
              color: "#e6edf3",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              margin: "0 0 0 4px",
            }}
          >
            {displayName}
          </p>

          {/* Count pill */}
          <CountPill instockNumber={count} wishedNumber={isWishedNumber} isIncreasing={isIncreasing}
            isDecreasing={isDecreasing} TEAL={TEAL} TEAL_B={TEAL_B} TEAL_D={TEAL_D} 
           />

          {/* Buttons */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: "flex", gap: 5, flexShrink: 0 }}
          >
            <button
              onClick={handleDec}
              disabled={isDecreasing}
              aria-label="Decrease"
              style={btnStyle(isDecreasing, "red")}
              onMouseEnter={(e) => {
                if (!isDecreasing) {
                  const b = e.currentTarget as HTMLElement;
                  b.style.backgroundColor = "#1c2128";
                  b.style.borderColor = "#f43f5e30";
                  b.style.color = "#fb7185";
                }
              }}
              onMouseLeave={(e) => {
                if (!isDecreasing) {
                  const b = e.currentTarget as HTMLElement;
                  b.style.backgroundColor = CARD;
                  b.style.borderColor = BORDER;
                  b.style.color = "#6e7681";
                }
              }}
            >
              -
            </button>
            <button
              onClick={handleInc}
              disabled={isIncreasing}
              aria-label="Increase"
              style={btnStyle(isIncreasing, "teal")}
              onMouseEnter={(e) => {
                if (!isIncreasing) {
                  const b = e.currentTarget as HTMLElement;
                  b.style.backgroundColor = "#1c2128";
                  b.style.borderColor = TEAL_B;
                  b.style.color = "#2dd4bf";
                }
              }}
              onMouseLeave={(e) => {
                if (!isIncreasing) {
                  const b = e.currentTarget as HTMLElement;
                  b.style.backgroundColor = CARD;
                  b.style.borderColor = BORDER;
                  b.style.color = "#6e7681";
                }
              }}
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
              color: open ? TEAL : "#4d5566",
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
              style={{ margin: "0 12px", height: 1, backgroundColor: BORDER }}
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
                      backgroundColor: SURFACE,
                      border: `1px solid ${BORDER}`,
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
                        alt={`image with url: ${imageUrl}`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          borderRadius: "8px"
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
                        color: "#e6edf3",
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
                            color: "#4d5566",
                            padding: "1px 5px",
                            border: `1px solid ${BORDER}`,
                            borderRadius: 4,
                            backgroundColor: CARD,
                            lineHeight: "16px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          EAN
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontFamily: "monospace",
                            color: "#8b949e",
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
                <div className="flex flex-wrap mt-3 mb-2">
                  {/* date count badge */}
                  <Badge
                    text_or_dates={dates}
                    type={BadgeType.DateBadge}
                    Color_1={"#2dd4bf"}
                    Color_2={TEAL_D}
                  />
                  {checkedTags.map((text, idx) => (
                    <Badge
                      key={idx}
                      text_or_dates={text}
                      type={BadgeType.TextBadge}
                      Color_1={"#2dd4bf"}
                      Color_2={TEAL_D}
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
                    scrollbarColor: `${BORDER} transparent`,
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
                        backgroundColor: CARD,
                        border: `1px solid ${BORDER}`,
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.borderColor =
                          TEAL_B)
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.borderColor =
                          BORDER)
                      }
                    >
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          backgroundColor: TEAL,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 13,
                          fontFamily: "monospace",
                          color: "#c9d1d9",
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
                    borderRadius: 999,
                    backgroundColor: "#fb7185",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "#4d5566",
                  }}
                >
                  No valid dates (code 42)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Container;
