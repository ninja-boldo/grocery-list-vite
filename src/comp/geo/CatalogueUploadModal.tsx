import { useState } from "react";
import { useTranslation } from "react-i18next";

export type CatalogueSubmitPayload = { file: File };

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
const isAccepted = (f: File) =>
  allowedMimeTypes.has(f.type) ||
  allowedExtensions.some((ext) => f.name.toLowerCase().endsWith(ext));

const CatalogueUploadModal = ({
  isOpen,
  onClose,
  submitCatalogue,
}: CatalogueUploadModalProps) => {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleClose = () => {
    setError(null);
    setIsSubmitting(false);
    setSuccess(false);
    setFile(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a file.");
      return;
    }
    if (!isAccepted(file)) {
      setError("Only JPEG, PNG and PDF files are supported.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await submitCatalogue({ file });
      setSuccess(true);
      setTimeout(handleClose, 1500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Upload failed. Please try again.",
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
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(92vw, 400px)",
          zIndex: 501,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          boxShadow: "var(--shadow-xl)",
          padding: "22px 20px 20px",
          fontFamily: "var(--font-body)",
          color: "var(--text-main)",
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
              {t("uploadCatalogue", "Upload Catalogue")}
            </h3>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              {t(
                "selectAPhotoOrPdfOfTheWeeklyFlyer",
                "Select a photo or PDF of the weekly flyer.",
              )}
            </p>
          </div>
          <button
            onClick={handleClose}
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

        {success ? (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "var(--success-bg)",
                border: "1px solid var(--success-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 10px",
              }}
            >
              <svg
                width="20"
                height="20"
                fill="none"
                stroke="var(--accent)"
                viewBox="0 0 24 24"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--accent-text)",
              }}
            >
              {t("submitted", "Submitted!")}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label
              style={{ display: "block", marginBottom: 14, cursor: "pointer" }}
            >
              <div
                style={{
                  border: `2px dashed ${file ? "var(--accent-border)" : "var(--border)"}`,
                  borderRadius: 12,
                  padding: "24px 16px",
                  textAlign: "center",
                  background: file ? "var(--accent-light)" : "var(--bg-alt)",
                  transition: "all 0.15s",
                }}
              >
                {file ? (
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>
                      {t("key5", "📄")}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--accent-text)",
                      }}
                    >
                      {file.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {(file.size / 1024).toFixed(0)}{" "}
                      {t("kbTapToChange", "KB · Tap to change")}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>
                      {t("key6", "📁")}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-muted)",
                      }}
                    >
                      {t("tapToSelectFile", "Tap to select file")}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-dim)",
                        marginTop: 2,
                      }}
                    >
                      {t("jpegPngPdf", "JPEG · PNG · PDF")}
                    </div>
                  </div>
                )}
              </div>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                onChange={(e) => {
                  setFile(e.currentTarget.files?.[0] ?? null);
                  setError(null);
                }}
                style={{ display: "none" }}
              />
            </label>

            {error && (
              <div
                style={{
                  marginBottom: 12,
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

            <button
              type="submit"
              disabled={isSubmitting || !file}
              style={{
                all: "unset",
                boxSizing: "border-box",
                display: "block",
                width: "100%",
                textAlign: "center",
                padding: "12px 0",
                borderRadius: 12,
                background: !file ? "var(--surface-2)" : "var(--accent)",
                color: !file ? "var(--text-subtle)" : "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: !file || isSubmitting ? "not-allowed" : "pointer",
                transition: "all 0.15s",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting
                ? "Uploading…"
                : t("submitCatalogue", "Submit Catalogue")}
            </button>
          </form>
        )}
      </div>
    </>
  );
};

export default CatalogueUploadModal;
