import { useState, type FormEvent } from "react";

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

const AddSupermarketModal = ({
  isOpen,
  onClose,
  onSubmit,
}: AddSupermarketModalProps) => {
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!name.trim() || !address.trim() || !city.trim()) {
      setError("Please provide name, address, and city.");
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
    } catch (submitError) {
      if (submitError instanceof Error && submitError.message) {
        setError(submitError.message);
      } else {
        setError("Failed to save supermarket.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        onClick={handleClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          background: "rgba(0, 0, 0, 0.45)",
          backdropFilter: "blur(2px)",
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add supermarket"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(92%, 520px)",
          zIndex: 41,
          borderRadius: 14,
          border: "1px solid rgba(255, 255, 255, 0.1)",
          background: "#0f1a14",
          boxShadow: "0 18px 48px rgba(0, 0, 0, 0.55)",
          color: "#e6f5ed",
          padding: "18px 18px 16px",
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={handleClose}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 26,
            height: 26,
            borderRadius: 8,
            border: "1px solid rgba(255, 255, 255, 0.12)",
            background: "rgba(255, 255, 255, 0.06)",
            color: "#cdd5cf",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
          Add Supermarket
        </h3>
        <p style={{ margin: "6px 0 14px", color: "#95b4a5", fontSize: 13 }}>
          Enter the supermarket details below.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
              Name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              type="text"
              required
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255, 255, 255, 0.12)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#f5fffa",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
              Address
            </span>
            <input
              value={address}
              onChange={(event) => setAddress(event.currentTarget.value)}
              type="text"
              required
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255, 255, 255, 0.12)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#f5fffa",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
              City
            </span>
            <input
              value={city}
              onChange={(event) => setCity(event.currentTarget.value)}
              type="text"
              required
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255, 255, 255, 0.12)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#f5fffa",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
              Category (optional)
            </span>
            <input
              value={category}
              onChange={(event) => setCategory(event.currentTarget.value)}
              type="text"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255, 255, 255, 0.12)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#f5fffa",
              }}
            />
          </label>

          {error && (
            <p style={{ margin: "0 0 12px", color: "#fda4af", fontSize: 13 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: "100%",
              padding: "11px 14px",
              borderRadius: 10,
              border: "1px solid rgba(45, 212, 160, 0.4)",
              background: isSubmitting ? "rgba(45, 212, 160, 0.35)" : "#2dd4a0",
              color: "#062315",
              fontWeight: 700,
              fontSize: 14,
              cursor: isSubmitting ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "Saving..." : "Save Supermarket"}
          </button>
        </form>
      </div>
    </>
  );
};

export default AddSupermarketModal;
