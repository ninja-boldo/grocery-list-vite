const ErrorContainer = ({ text }: { text: string }) => (
  <div
    style={{
      margin: "12px",
      padding: "14px 16px",
      background: "var(--error-bg)",
      border: "1px solid var(--error-border)",
      borderRadius: 14,
      color: "var(--error)",
      fontSize: 14,
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
    }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      style={{ flexShrink: 0, marginTop: 1 }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
    <span style={{ lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{text}</span>
  </div>
);
export default ErrorContainer;
