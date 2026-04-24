import { useState } from "react";
import { API_PATHS, type TokenResponse } from "@/lib/api/openapi";

type AuthPopupProps = { onAuthenticated?: () => void; }

const AuthPopup = ({ onAuthenticated }: AuthPopupProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sendAuthReq = async () => {
    if (!username || !password) { setError("Please enter username and password."); return; }
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(API_PATHS.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, password }).toString(),
      });
      const result = (await response.json()) as Partial<TokenResponse>;
      if (!response.ok || !result?.access_token) { setError("Login failed. Please check your credentials."); return; }
      localStorage.setItem("jwt_auth", `Bearer ${result.access_token}`);
      localStorage.setItem("username", username);
      onAuthenticated?.();
    } catch { setError("Login request failed. Please try again."); }
    finally { setIsSubmitting(false); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 3000,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "1rem",
      background: "rgba(28,26,22,0.5)",
      backdropFilter: "blur(8px)",
    }}>
      <div style={{
        width: "min(440px, 100%)",
        borderRadius: 20,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-xl)",
        padding: "28px 24px 24px",
        color: "var(--text-main)",
      }}>
        {/* Logo / icon */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 20,
          }}>🛒</div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600 }}>Sign in</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Your session expired — please re-authenticate</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Username</label>
            <input
              style={{
                width: "100%", borderRadius: 10, border: "1px solid var(--border)",
                background: "var(--bg-alt)", color: "var(--text-main)",
                padding: "10px 12px", outline: "none", fontSize: 14,
                transition: "border-color 0.15s",
              }}
              placeholder="username"
              value={username}
              onChange={e => setUsername(e.currentTarget.value)}
              onFocus={e => (e.currentTarget.style.borderColor = "var(--accent-border)")}
              onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5 }}>Password</label>
            <input
              style={{
                width: "100%", borderRadius: 10, border: "1px solid var(--border)",
                background: "var(--bg-alt)", color: "var(--text-main)",
                padding: "10px 12px", outline: "none", fontSize: 14,
                transition: "border-color 0.15s",
              }}
              type="password"
              placeholder="password"
              value={password}
              onChange={e => setPassword(e.currentTarget.value)}
              onFocus={e => (e.currentTarget.style.borderColor = "var(--accent-border)")}
              onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
              onKeyDown={e => { if (e.key === "Enter") void sendAuthReq(); }}
            />
          </div>

          {error && (
            <div style={{
              padding: "9px 12px",
              background: "var(--error-bg)",
              border: "1px solid var(--error-border)",
              borderRadius: 10, fontSize: 13, color: "var(--error)",
            }}>{error}</div>
          )}

          <button
            onClick={() => void sendAuthReq()}
            disabled={isSubmitting}
            style={{
              marginTop: 4,
              width: "100%", borderRadius: 12, border: "none",
              background: isSubmitting ? "var(--accent-border)" : "var(--accent)",
              color: "#fff", padding: "12px",
              fontSize: 15, fontWeight: 600,
              cursor: isSubmitting ? "not-allowed" : "pointer",
              transition: "all 0.15s",
              fontFamily: "var(--font-body)",
            }}
          >
            {isSubmitting ? "Signing in…" : "Continue"}
          </button>

          <p style={{ fontSize: 12, textAlign: "center", color: "var(--text-dim)", margin: 0 }}>
            Demo: <strong style={{ color: "var(--text-muted)" }}>demo</strong> / <strong style={{ color: "var(--text-muted)" }}>demo</strong>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthPopup;
