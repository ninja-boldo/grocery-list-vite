import { memo, useEffect, useRef, useState } from "react";

export type ToastVariant = "success" | "error";

export type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type FeedbackToastProps = {
  toast: Toast | null;
  onDismiss: () => void;
};

/**
 * Fixed-position toast notification, anchored above the BottomTabBar.
 * Slides in from below, auto-dismisses after 4.5 s.
 * Caller is responsible for setting / clearing the toast state.
 */
const FeedbackToast = memo(({ toast, onDismiss }: FeedbackToastProps) => {
  const [visible, setVisible] = useState(false);
  const prevIdRef = useRef<number | null>(null);

  // Trigger entrance animation whenever a new toast arrives
  useEffect(() => {
    if (!toast) {
      setVisible(false);
      return;
    }
    if (toast.id !== prevIdRef.current) {
      prevIdRef.current = toast.id;
      // Small rAF tick so the initial transform is painted before we flip visible
      requestAnimationFrame(() => setVisible(true));
    }
  }, [toast]);

  if (!toast) return null;

  const isSuccess = toast.variant === "success";

  const colors = isSuccess
    ? {
        bg: "#0f2a28",
        border: "#0d948850",
        text: "#5eead4",
        icon: "#1D9E75",
      }
    : {
        bg: "#2a1111",
        border: "#ef444430",
        text: "#fca5a5",
        icon: "#ef4444",
      };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 96,
        left: "50%",
        transform: visible
          ? "translateX(-50%) translateY(0)"
          : "translateX(-50%) translateY(20px)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease",
        zIndex: 200,
        minWidth: 260,
        maxWidth: "calc(100vw - 32px)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        style={{
          backgroundColor: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: "12px 14px",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          boxShadow: "0 8px 32px #00000070",
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            backgroundColor: isSuccess ? "#1a3830" : "#3a1010",
            border: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          {isSuccess ? (
            <svg width="11" height="11" fill="none" stroke={colors.icon} viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="11" height="11" fill="none" stroke={colors.icon} viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </div>

        {/* Message */}
        <span style={{ flex: 1, fontSize: 13, color: colors.text, lineHeight: 1.5, wordBreak: "break-word" }}>
          {toast.message}
        </span>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          style={{
            all: "unset",
            cursor: "pointer",
            color: colors.text,
            opacity: 0.6,
            fontSize: 18,
            lineHeight: 1,
            flexShrink: 0,
            padding: "0 2px",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.6")}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
});

export default FeedbackToast;

// ── Hook ────────────────────────────────────────────────────────────────────
let _toastCounter = 0;

/**
 * Convenience hook for managing toast state.
 * Returns [toast, showToast, clearToast].
 */
export function useFeedbackToast(autoDismissMs = 4500) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, variant: ToastVariant) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ id: ++_toastCounter, message, variant });
    timerRef.current = setTimeout(() => setToast(null), autoDismissMs);
  };

  const clearToast = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return [toast, showToast, clearToast] as const;
}
