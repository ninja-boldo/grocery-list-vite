import { useTranslation } from "react-i18next";
type QuantityRequiredModalProps = {
  open: boolean;
  itemName: string;
  quantityValue: string;
  unitValue: string;
  units: readonly string[];
  submitting?: boolean;
  onQuantityChange: (value: string) => void;
  onUnitChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

const QuantityRequiredModal = ({
  open,
  itemName,
  quantityValue,
  unitValue,
  units,
  submitting = false,
  onQuantityChange,
  onUnitChange,
  onConfirm,
  onClose,
}: QuantityRequiredModalProps) => {
  const { t } = useTranslation();
  if (!open) {
    return null;
  }

  const parsedQuantity = Number.parseFloat(quantityValue);
  const canSubmit =
    Number.isFinite(parsedQuantity) && parsedQuantity > 0 && !submitting;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("quantityDetailsRequired", "Quantity details required")}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 20% 12%, rgba(244, 198, 123, 0.18), transparent 35%), rgba(8, 12, 17, 0.74)",
        backdropFilter: "blur(8px)",
        padding: "14px",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 24,
          border: "1px solid rgba(124, 170, 124, 0.34)",
          background:
            "linear-gradient(165deg, rgba(18, 24, 31, 0.98) 0%, rgba(18, 28, 27, 0.95) 50%, rgba(20, 20, 17, 0.98) 100%)",
          boxShadow: "0 22px 65px rgba(0, 0, 0, 0.55)",
          padding: "18px 18px 16px",
        }}
      >
        <div
          style={{
            width: 42,
            height: 4,
            borderRadius: 999,
            margin: "0 auto 14px",
            background: "rgba(156, 163, 175, 0.35)",
          }}
        />

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 10px",
            borderRadius: 999,
            border: "1px solid rgba(229, 165, 92, 0.35)",
            background: "rgba(125, 83, 36, 0.2)",
            color: "#f5cf9d",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {t("quantityRequired", "Quantity Required")}
        </div>

        <h3
          style={{
            margin: "12px 0 6px",
            fontSize: 20,
            lineHeight: 1.25,
            color: "#f8f5ee",
            fontFamily: "var(--font-display)",
          }}
        >
          {t("addQuantityAndUnit", "Add quantity and unit")}
        </h3>

        <p style={{ margin: "0 0 14px", fontSize: 13, color: "#b4bfbe" }}>
          {t(
            "theServerNeedsQuantityDetailsFor",
            "The server needs quantity details for",
          )}
          <span style={{ color: "#e8f4d3", fontWeight: 700 }}> {itemName}</span>{" "}
          {t("beforeItCanSaveThisItem", "before it can save this item.")}
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: "block",
                fontSize: 11,
                marginBottom: 6,
                color: "#95a6a4",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
              }}
            >
              {t("quantity", "Quantity")}
            </label>
            <input
              type="number"
              min="0.01"
              step="any"
              value={quantityValue}
              onChange={(event) => onQuantityChange(event.target.value)}
              autoFocus
              style={{
                width: "100%",
                boxSizing: "border-box",
                borderRadius: 12,
                border: "1px solid rgba(124, 170, 124, 0.45)",
                background: "rgba(12, 16, 23, 0.86)",
                color: "#f2f5f7",
                padding: "11px 12px",
                fontSize: 16,
                fontWeight: 700,
                outline: "none",
              }}
            />
          </div>

          <div style={{ width: 130 }}>
            <label
              style={{
                display: "block",
                fontSize: 11,
                marginBottom: 6,
                color: "#95a6a4",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
              }}
            >
              {t("unit", "Unit")}
            </label>
            <select
              value={unitValue}
              onChange={(event) => onUnitChange(event.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                borderRadius: 12,
                border: "1px solid rgba(124, 170, 124, 0.35)",
                background: "rgba(12, 16, 23, 0.86)",
                color: "#f2f5f7",
                padding: "11px 10px",
                fontSize: 14,
                outline: "none",
                cursor: "pointer",
              }}
            >
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={onConfirm}
          disabled={!canSubmit}
          style={{
            width: "100%",
            borderRadius: 13,
            border: "1px solid rgba(124, 170, 124, 0.55)",
            background: canSubmit
              ? "linear-gradient(135deg, rgba(124, 170, 124, 0.95) 0%, rgba(80, 121, 92, 0.95) 100%)"
              : "rgba(44, 56, 58, 0.8)",
            color: canSubmit ? "#101c12" : "#7f8d8a",
            fontWeight: 800,
            fontSize: 14,
            padding: "12px 14px",
            cursor: canSubmit ? "pointer" : "not-allowed",
            marginBottom: 10,
          }}
        >
          {submitting
            ? t("savingItem", "Saving item...")
            : t("saveItemWithQuantity", "Save item with quantity")}
        </button>

        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          style={{
            width: "100%",
            borderRadius: 13,
            border: "1px solid rgba(95, 111, 115, 0.5)",
            background: "rgba(20, 26, 34, 0.8)",
            color: "#94a3b8",
            fontWeight: 700,
            fontSize: 13,
            padding: "11px 12px",
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {t("cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
};

export default QuantityRequiredModal;
