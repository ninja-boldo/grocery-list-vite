import { useState } from "react";

// ─── Design tokens (match your app's existing palette) ────────────────────────
const T = {
  bg: "#0d1117", // page background
  card: "#161b22", // card surface
  cardHover: "#1a2130", // card hovered
  border: "#21262d", // default border
  borderActive: "#0d9488", // teal border when expanded
  teal: "#0d9488",
  tealDim: "rgba(13,148,136,0.15)",
  tealBorder: "rgba(13,148,136,0.35)",
  textPrimary: "#e6edf3",
  textSecondary: "#8b949e",
  textDim: "#4d5566",
} as const;

// ─── Formatters ───────────────────────────────────────────────────────────────
const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const decimal = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

function formatSize(weight_g: number | null, volume_ml: number | null): string {
  if (weight_g !== null) return `${weight_g} g`;
  if (volume_ml !== null) return `${volume_ml} ml`;
  return "—";
}

function formatUnitPrice(
  price: number,
  weight_g: number | null,
  volume_ml: number | null,
): string | null {
  if (weight_g !== null && weight_g > 0)
    return `${decimal.format(price / (weight_g / 1000))} €/kg`;
  if (volume_ml !== null && volume_ml > 0)
    return `${decimal.format(price / (volume_ml / 1000))} €/L`;
  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type OfferCardProps = {
  name: string;
  shortened_name: string;
  weight_g: number | null;
  volume_ml: number | null;
  normal_price: number;
  discount_price: number;
  discount_rate: number;
  is_app_offer: boolean;
  className?: string;
  style?: React.CSSProperties;
};

// ─── Chevron icon ─────────────────────────────────────────────────────────────
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        transition: "transform 0.22s ease",
        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        color: expanded ? T.teal : T.textDim,
      }}
    >
      <path d="M3 5l4 4 4-4" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function OfferCard({
  name,
  shortened_name,
  weight_g,
  volume_ml,
  normal_price,
  discount_price,
  discount_rate,
  is_app_offer,
  className,
  style,
}: OfferCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const savings = Math.max(normal_price - discount_price, 0);
  const rate =
    normal_price > 0
      ? clamp(savings / normal_price, 0, 1)
      : clamp(discount_rate, 0, 1);
  const pct = Math.round(rate * 100);

  const sizeLabel = formatSize(weight_g, volume_ml);
  const unitPriceSale = formatUnitPrice(discount_price, weight_g, volume_ml);
  const unitPriceNormal = formatUnitPrice(normal_price, weight_g, volume_ml);

  // Teal accent strength scales with discount depth
  const strongDeal = rate >= 0.25;

  return (
    <article
      className={className}
      onClick={() => setExpanded((v) => !v)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: hovered && !expanded ? T.cardHover : T.card,
        border: `1px solid ${expanded ? T.borderActive : hovered ? "#2d333b" : T.border}`,
        borderRadius: 12,
        overflow: "hidden",
        cursor: "pointer",
        position: "relative",
        transition: "border-color 0.15s, background-color 0.15s",
        margin: "4px 0",
        ...style,
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          backgroundColor: strongDeal ? T.teal : T.border,
          borderRadius: "12px 0 0 12px",
          opacity: strongDeal ? 1 : 0.5,
          transition: "background-color 0.2s",
        }}
      />

      {/* ── Collapsed header ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 10px 9px 14px",
        }}
      >
        {/* Name block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: T.textPrimary,
              margin: 0,
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {shortened_name}
          </p>
          <p
            title={name}
            style={{
              fontSize: 10.5,
              color: T.textDim,
              margin: "1px 0 0",
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </p>
        </div>

        {/* Price + badge */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
            flexShrink: 0,
          }}
        >
          {/* Discount badge */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: strongDeal ? "#2dd4bf" : T.textSecondary,
              backgroundColor: strongDeal
                ? "rgba(13,148,136,0.12)"
                : "transparent",
              border: `1px solid ${strongDeal ? T.tealBorder : T.border}`,
              borderRadius: 6,
              padding: "1px 6px",
            }}
          >
            -{pct}%
          </span>

          {/* Prices */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span
              style={{
                fontSize: 17,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1,
                color: strongDeal ? "#2dd4bf" : T.textPrimary,
              }}
            >
              {euro.format(discount_price)}
            </span>
            <span
              style={{
                fontSize: 10.5,
                color: T.textDim,
                textDecoration: "line-through",
                lineHeight: 1,
              }}
            >
              {euro.format(normal_price)}
            </span>
          </div>
        </div>

        <ChevronIcon expanded={expanded} />
      </div>

      {/* ── Expanded detail panel ────────────────────────────────────────── */}
      <div
        style={{
          maxHeight: expanded ? 200 : 0,
          overflow: "hidden",
          transition: "max-height 0.26s ease",
        }}
      >
        <div
          style={{
            borderTop: `1px solid ${T.border}`,
            padding: "10px 12px 12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 7,
          }}
        >
          {/* Detail rows */}
          {[
            { label: "Quantity", value: sizeLabel },
            unitPriceSale && {
              label: "Unit price (offer)",
              value: unitPriceSale,
            },
            unitPriceNormal && {
              label: "Unit price (normal)",
              value: unitPriceNormal,
              dim: true,
            },
          ]
            .filter(Boolean)
            .map((row: any) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                }}
              >
                <span style={{ color: T.textSecondary }}>{row.label}</span>
                <span
                  style={{
                    color: row.dim ? T.textDim : T.textPrimary,
                    textDecoration: row.dim ? "line-through" : "none",
                    fontWeight: 500,
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}

          {/* Savings pill */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              backgroundColor: strongDeal
                ? "rgba(13,148,136,0.08)"
                : "rgba(255,255,255,0.04)",
              border: `1px solid ${strongDeal ? T.tealBorder : T.border}`,
              borderRadius: 8,
              padding: "5px 10px",
              marginTop: 2,
              fontSize: 12,
            }}
          >
            <span style={{ color: T.textSecondary }}>Savings</span>
            <span
              style={{
                fontWeight: 700,
                color: strongDeal ? "#2dd4bf" : T.textSecondary,
              }}
            >
              {euro.format(savings)} · {pct}% off
            </span>
          </div>

          {/* Channel tag — bottom right */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: is_app_offer ? "#2dd4bf" : T.textSecondary,
                backgroundColor: is_app_offer ? T.tealDim : "transparent",
                border: `1px solid ${is_app_offer ? T.tealBorder : T.border}`,
                borderRadius: 5,
                padding: "2px 7px",
              }}
            >
              {is_app_offer ? "App offer" : "In store"}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
