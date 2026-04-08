import { useState } from "react";

export type CatalogueSubmitPayload = {
  file: File;
};

type CatalogueUploadModalProps = {
  isOpen: boolean;
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
  if (allowedMimeTypes.has(file.type)) return true;
  const lowerName = file.name.toLowerCase();
  return allowedExtensions.some((ext) => lowerName.endsWith(ext));
};

const P = {
  bg: "#0D1117",
  surface: "#161b22",
  border: "#21262d",
  teal: "#1D9E75",
  tealD: "#0f2a28",
  tealB: "#0d948850",
  text: "#e6edf3",
  muted: "#6e7681",
  subtle: "#4d5566",
} as const;

const CatalogueUploadModal = ({
  isOpen,
  onClose,
  submitCatalogue,
}: CatalogueUploadModalProps) => {
  const [catalogueFile, setCatalogueFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleClose = () => {
    setError(null);
    setIsSubmitting(false);
    setSuccess(false);
    setCatalogueFile(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!catalogueFile) {
      setError("Please select a catalogue file.");
      return;
    }

    if (!isAcceptedFileType(catalogueFile)) {
      setError("Only JPEG, PNG, and PDF files are supported.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await submitCatalogue({ file: catalogueFile });
      setSuccess(true);
      setTimeout(handleClose, 1200);
    } catch (submitError) {
      if (submitError instanceof Error && submitError.message) {
        setError(submitError.message);
      } else {
        setError("Failed to submit catalogue. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop — position:fixed so it covers the full viewport */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100,
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(3px)",
        }}
      />

      {/* Dialog — position:fixed, centered in viewport */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upload catalogue"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(92vw, 400px)",
          zIndex: 101,
          backgroundColor: P.surface,
          border: `1px solid ${P.border}`,
          borderRadius: 18,
          boxShadow: "0 20px 60px #00000080",
          color: P.text,
          padding: "20px 18px 18px",
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close"
          onClick={handleClose}
          style={{
            all: "unset",
            boxSizing: "border-box",
            position: "absolute",
            top: 12,
            right: 12,
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            border: `1px solid ${P.border}`,
            backgroundColor: P.bg,
            color: P.muted,
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = P.text;
            (e.currentTarget as HTMLElement).style.borderColor = "#ef444430";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = P.muted;
            (e.currentTarget as HTMLElement).style.borderColor = P.border;
          }}
        >
          ×
        </button>

        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: P.text }}>
            Upload Catalogue
          </h3>
          <p style={{ margin: "5px 0 0", fontSize: 12, color: P.muted }}>
            Select a photo or PDF of the store's weekly catalogue.
          </p>
        </div>

        {success ? (
          /* Success state */
          <div
            style={{
              padding: "20px 0",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                backgroundColor: P.tealD,
                border: `1px solid ${P.tealB}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="18" height="18" fill="none" stroke="#5eead4" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#5eead4" }}>
              Submitted!
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* File drop zone */}
            <label
              style={{
                display: "block",
                marginBottom: 14,
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  border: `2px dashed ${catalogueFile ? P.tealB : P.border}`,
                  borderRadius: 12,
                  padding: "24px 16px",
                  textAlign: "center",
                  backgroundColor: catalogueFile ? P.tealD : P.bg,
                  transition: "all 0.15s",
                }}
              >
                {catalogueFile ? (
                  <div>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>📄</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#5eead4" }}>
                      {catalogueFile.name}
                    </div>
                    <div style={{ fontSize: 11, color: P.muted, marginTop: 2 }}>
                      {(catalogueFile.size / 1024).toFixed(0)} KB · Click to change
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>📁</div>
                    <div style={{ fontSize: 13, color: P.muted, fontWeight: 500 }}>
                      Tap to select file
                    </div>
                    <div style={{ fontSize: 11, color: P.subtle, marginTop: 2 }}>
                      JPEG · PNG · PDF
                    </div>
                  </div>
                )}
              </div>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                onChange={(e) => {
                  setCatalogueFile(e.currentTarget.files?.[0] ?? null);
                  setError(null);
                }}
                style={{ display: "none" }}
              />
            </label>

            {/* Error */}
            {error && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "9px 12px",
                  backgroundColor: "#2a1111",
                  border: "1px solid #ef444430",
                  borderRadius: 10,
                  fontSize: 13,
                  color: "#fca5a5",
                }}
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting || !catalogueFile}
              style={{
                all: "unset",
                boxSizing: "border-box",
                display: "block",
                width: "100%",
                textAlign: "center",
                padding: "11px 0",
                borderRadius: 12,
                backgroundColor:
                  isSubmitting || !catalogueFile ? P.bg : P.tealD,
                border: `1px solid ${isSubmitting || !catalogueFile ? P.border : P.tealB}`,
                color:
                  isSubmitting || !catalogueFile ? P.subtle : "#5eead4",
                fontSize: 13,
                fontWeight: 600,
                cursor: isSubmitting || !catalogueFile ? "not-allowed" : "pointer",
                transition: "all 0.15s",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Uploading..." : "Submit Catalogue"}
            </button>
          </form>
        )}
      </div>
    </>
  );
};

export default CatalogueUploadModal;
