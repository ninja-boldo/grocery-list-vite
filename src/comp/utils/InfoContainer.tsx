const InfoContainer = ({ text }: { text: string }) => (
  <div style={{
    margin: "32px 16px", padding: "24px", textAlign: "center",
    color: "var(--text-dim)", fontSize: 14, lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  }}>
    <div style={{ fontSize: 32, marginBottom: 12 }}>🛒</div>
    {text}
  </div>
);
export default InfoContainer;
