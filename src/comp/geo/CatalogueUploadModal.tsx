import { useMemo, useState } from "react";
import type { Position } from "./Map";

export type CatalogueSubmitPayload = {
  name: string;
  address: string;
  postcode: string;
  city?: string;
  categories?: string;
  file: File;
};

type CatalogueUploadModalProps = {
  isOpen: boolean;
  position: Position | null;
  onClose: () => void;
  submitCatalogue: (payload: CatalogueSubmitPayload) => Promise<void>;
};

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const allowedExtensions = [".jpg", ".jpeg", ".png", ".pdf"];

const isAcceptedFileType = (file: File) => {
  if (allowedMimeTypes.has(file.type)) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return allowedExtensions.some((ext) => lowerName.endsWith(ext));
};

const CatalogueUploadModal = ({
  isOpen,
  position,
  onClose,
  submitCatalogue,
}: CatalogueUploadModalProps) => {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState("");
  const [catalogueFile, setCatalogueFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const positionText = useMemo(() => {
    if (!position) {
      return "No map position selected";
    }
    return `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`;
  }, [position]);

  const handleClose = () => {
    setError(null);
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!position) {
      setError("Missing selected map position.");
      return;
    }

    if (!name.trim() || !address.trim() || !postcode.trim()) {
      setError("Please provide supermarket name, address, and postcode.");
      return;
    }

    if (!catalogueFile) {
      setError("Please upload a catalogue file.");
      return;
    }

    if (!isAcceptedFileType(catalogueFile)) {
      setError("Only JPEG, PNG, and PDF files are supported.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await submitCatalogue({
        name: name.trim(),
        address: address.trim(),
        postcode: postcode.trim(),
        city: city.trim() || undefined,
        categories: categories.trim() || undefined,
        file: catalogueFile,
      });

      setName("");
      setAddress("");
      setPostcode("");
      setCity("");
      setCategories("");
      setCatalogueFile(null);
      handleClose();
    } catch (submitError) {
      if (submitError instanceof Error && submitError.message) {
        setError(submitError.message);
      } else {
        setError("Failed to submit catalogue.");
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
          position: "absolute",
          inset: 0,
          zIndex: 30,
          background: "rgba(0, 0, 0, 0.45)",
          backdropFilter: "blur(2px)",
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Submit catalogue"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(92%, 520px)",
          zIndex: 31,
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
          Submit Catalogue
        </h3>
        <p style={{ margin: "6px 0 14px", color: "#95b4a5", fontSize: 13 }}>
          Position: {positionText}
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
              supermarket name
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
              Postcode
            </span>
            <input
              value={postcode}
              onChange={(event) => setPostcode(event.currentTarget.value)}
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
              City (optional)
            </span>
            <input
              value={city}
              onChange={(event) => setCity(event.currentTarget.value)}
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

          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
              Categories (optional)
            </span>
            <input
              value={categories}
              onChange={(event) => setCategories(event.currentTarget.value)}
              type="text"
              placeholder="comma,separated,categories"
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

          <label style={{ display: "block", marginBottom: 6 }}>
            <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
              Catalogue File
            </span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
              onChange={(event) =>
                setCatalogueFile(event.currentTarget.files?.[0] ?? null)
              }
              required
              style={{ width: "100%", color: "#d7e6dd" }}
            />
          </label>

          <p style={{ margin: "0 0 12px", fontSize: 12, color: "#8cb19f" }}>
            Allowed types: JPEG, PNG, PDF
          </p>

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
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </form>
      </div>
    </>
  );
};

export default CatalogueUploadModal;
