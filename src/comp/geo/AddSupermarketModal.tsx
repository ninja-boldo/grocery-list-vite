import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

export type AddSupermarketPayload = {
  name: string;
  address: string;
  city: string;
  category?: string;
};

type AddSupermarketModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: AddSupermarketPayload) => Promise<void> | void;
};

const Field = ({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) => (
  <div>
    <label
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text-muted)",
        display: "block",
        marginBottom: 5,
      }}
    >
      {label}
    </label>
    <input
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg-alt)",
        color: "var(--text-main)",
        padding: "10px 12px",
        outline: "none",
        fontSize: 14,
        transition: "border-color 0.15s",
      }}
      onFocus={(e) =>
        (e.currentTarget.style.borderColor = "var(--accent-border)")
      }
      onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
    />
  </div>
);

const AddSupermarketModal = ({
  isOpen,
  onClose,
  onSubmit,
}: AddSupermarketModalProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    setError(null);
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim() || !city.trim()) {
      setError("Please fill in name, address, and city.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        address: address.trim(),
        city: city.trim(),
        category: category.trim() || undefined,
      });
      setName("");
      setAddress("");
      setCity("");
      setCategory("");
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Submission failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={handleClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 500,
          background: "rgba(28,26,22,0.45)",
          backdropFilter: "blur(4px)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("addSupermarket2", "Add supermarket")}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(92vw, 420px)",
          zIndex: 501,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          boxShadow: "var(--shadow-xl)",
          padding: "22px 20px 20px",
          color: "var(--text-main)",
          fontFamily: "var(--font-body)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              {t("addSupermarket", "Add Supermarket")}
            </h3>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              {t("submitANewStoreToTheMap", "Submit a new store to the map.")}
            </p>
          </div>
          <button
            onClick={handleClose}
            aria-label={t("close", "Close")}
            style={{
              all: "unset",
              boxSizing: "border-box",
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              background: "var(--surface-2)",
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: 18,
              transition: "all 0.12s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--error-bg)";
              (e.currentTarget as HTMLElement).style.color = "var(--error)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--surface-2)";
              (e.currentTarget as HTMLElement).style.color = "var(--text-dim)";
            }}
          >
            ×
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <Field
            label={t("storeName", "Store name *")}
            value={name}
            onChange={setName}
            placeholder={t("egReweMarkt", "e.g. REWE Markt")}
          />
          <Field
            label={t("streetNumber", "Street & number *")}
            value={address}
            onChange={setAddress}
            placeholder={t("egHauptstrae12", "e.g. Hauptstraße 12")}
          />
          <Field
            label={t("city", "City *")}
            value={city}
            onChange={setCity}
            placeholder={t("egDsseldorf", "e.g. Düsseldorf")}
          />
          <Field
            label="Category"
            value={category}
            onChange={setCategory}
            placeholder={t("egSupermarket", "e.g. Supermarket")}
          />

          {error && (
            <div
              style={{
                padding: "9px 12px",
                background: "var(--error-bg)",
                border: "1px solid var(--error-border)",
                borderRadius: 10,
                fontSize: 13,
                color: "var(--error)",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={handleClose}
              style={{
                flex: 1,
                padding: "11px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text-muted)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {t("cancel", "Cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                flex: 2,
                padding: "11px",
                borderRadius: 12,
                border: "none",
                background: isSubmitting
                  ? "var(--accent-border)"
                  : "var(--accent)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: isSubmitting ? "not-allowed" : "pointer",
                transition: "background 0.15s",
              }}
            >
              {isSubmitting ? "Submitting…" : t("addStore", "Add Store")}
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default AddSupermarketModal;
