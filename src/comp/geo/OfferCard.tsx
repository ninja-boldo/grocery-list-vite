import { useState } from "react";
import { useTranslation } from "react-i18next";

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

export type OfferCardProps = {
  name: string;
  shortened_name: string;
  weight_g: number | null;
  volume_ml: number | null;
  normal_price: number;
  discount_price: number;
  discount_rate: number;
  is_app_offer: boolean;
  category?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  image_url?: string | null;
};

function formatSize(w: number | null, v: number | null): string {
  if (w !== null) return `${w} g`;
  if (v !== null) return `${v} ml`;
  return "—";
}

function formatUnitPrice(
  price: number,
  w: number | null,
  v: number | null,
): string | null {
  if (w !== null && w > 0)
    return `${((price / weight) * 1000).toFixed(2)} €/kg`;
  if (v !== null && v > 0) return `${((price / volume) * 1000).toFixed(2)} €/L`;
  return null;
}

const OfferCard = (props: OfferCardProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const {
    name,
    shortened_name,
    weight_g,
    volume_ml,
    normal_price,
    discount_price,
    discount_rate,
    is_app_offer,
    valid_until,
  } = props;
  const displayName = shortened_name || name;
  const size = formatSize(weight_g, volume_ml);
  const unitPrice = formatUnitPrice(discount_price, weight_g, volume_ml);
  const pct = Math.round(Math.min(Math.max(discount_rate, 0), 1) * 100);
  const savings = normal_price - discount_price;

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: expanded ? "14px 14px 12px" : "12px 14px",
        cursor: "pointer",
        transition: "all 0.15s",
        borderColor: expanded ? "var(--accent-border)" : "var(--border)",
        boxShadow: expanded ? "var(--shadow-md)" : "var(--shadow-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-main)",
              marginBottom: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{size}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: "var(--accent-text)",
              }}
            >
              {euro.format(discount_price)}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-dim)",
                textDecoration: "line-through",
              }}
            >
              {euro.format(normal_price)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 4,
              justifyContent: "flex-end",
              marginTop: 3,
            }}
          >
            {pct > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 6,
                  background: "var(--success-bg)",
                  color: "var(--success)",
                  border: "1px solid var(--success-border)",
                }}
              >
                {t("pct", "−{{pct}}%", { pct })}
              </span>
            )}
            {is_app_offer && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: 6,
                  background: "var(--warning-bg)",
                  color: "var(--warning)",
                  border: "1px solid var(--warning-border)",
                }}
              >
                {t("app", "App")}
              </span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
            display: "grid",
            gap: 5,
          }}
        >
          {savings > 0 && (
            <Row
              label={t("youSave", "You save")}
              val={euro.format(savings)}
              accent
            />
          )}
          {unitPrice && (
            <Row label={t("unitPrice", "Unit price")} val={unitPrice} />
          )}
          {valid_until && (
            <Row
              label={t("validUntil", "Valid until")}
              val={new Date(valid_until).toLocaleDateString("de-DE")}
            />
          )}
        </div>
      )}
    </div>
  );
};

const Row = ({
  label,
  val,
  accent,
}: {
  label: string;
  val: string;
  accent?: boolean;
}) => (
  <div
    style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}
  >
    <span style={{ color: "var(--text-muted)" }}>{label}</span>
    <span
      style={{
        fontWeight: 600,
        color: accent ? "var(--accent-text)" : "var(--text-main)",
      }}
    >
      {val}
    </span>
  </div>
);

export default OfferCard;
