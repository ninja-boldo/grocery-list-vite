import React from "react";
import { useTranslation } from "react-i18next";

interface VoiceRecorderProps {
  isRecording: boolean;
  isLoading: boolean;
  onRecordClick: () => void;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  isRecording,
  isLoading,
  onRecordClick,
}) => {
  const { t } = useTranslation();
  return (
    <button
      onClick={onRecordClick}
      disabled={isLoading}
      style={{
        all: "unset",
        boxSizing: "border-box",
        position: "fixed",
        bottom: "80px",
        right: "20px",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 52,
        height: 52,
        fontSize: 12,
        borderRadius: "50%",
        backgroundColor: isRecording ? "var(--error-bg)" : "var(--accent)",
        color: isRecording ? "var(--error)" : "#ffffff",
        border: isRecording ? "1px solid #f8717150" : "none",
        cursor: isLoading ? "not-allowed" : "pointer",
        opacity: isLoading ? 0.5 : 1,
        transition: "all 0.15s",
        boxShadow: isRecording
          ? "0 4px 20px #f8717140"
          : "0 4px 20px #1D9E7555",
        animation: isRecording ? "vr-ring 2s ease-in-out infinite" : "none",
      }}
      onMouseEnter={(e) => {
        if (!isLoading) {
          e.currentTarget.style.opacity = "0.9";
          e.currentTarget.style.transform = "scale(1.05)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.transform = "scale(1)";
      }}
      title={
        isRecording
          ? t("stopRecording", "Stop recording")
          : t("startRecording", "Start recording")
      }
    >
      {isLoading ? (
        <svg
          style={{
            width: "16px",
            height: "16px",
            animation: "vr-spin 1s linear infinite",
          }}
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            style={{ opacity: 0.2 }}
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            style={{ opacity: 0.8 }}
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : isRecording ? (
        <svg
          style={{ width: "14px", height: "14px" }}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : (
        <svg
          style={{ width: "16px", height: "16px" }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
          />
        </svg>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes vr-ring {
          0%, 100% { box-shadow: 0 0 0 2px #f8717130; }
          50%       { box-shadow: 0 0 0 4px #f8717140; }
        }
        @keyframes vr-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `,
        }}
      />
    </button>
  );
};

export default VoiceRecorder;
