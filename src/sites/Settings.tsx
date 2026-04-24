import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import FeedbackToast, { useFeedbackToast } from "@/comp/utils/FeedbackToast";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import { API_PATHS, type PlannerSettingsPayload } from "@/lib/api/openapi";

// ── Shared tokens ──────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 16, padding: 18, boxShadow: "var(--shadow-sm)",
};
const sectionTitle: React.CSSProperties = {
  fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600,
  color: "var(--text-main)", margin: "0 0 4px",
};
const sectionSub: React.CSSProperties = {
  fontSize: 12, color: "var(--text-muted)", margin: "0 0 16px",
};
const fieldLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 5,
};
const inputStyle: React.CSSProperties = {
  width: "100%", borderRadius: 10, border: "1px solid var(--border)",
  background: "var(--bg-alt)", color: "var(--text-main)",
  padding: "10px 12px", outline: "none", fontSize: 14, transition: "border-color 0.15s",
};
const divider: React.CSSProperties = {
  height: 1, background: "var(--border)", margin: "14px 0",
};

// ── Stepper ─────────────────────────────────────────────────────────────────
const Stepper = ({ value, onChange, min = 1, max = 99 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <button onClick={() => onChange(Math.max(min, value - 1))} style={{
      width: 30, height: 30, borderRadius: 8, background: "var(--surface-2)",
      border: "1px solid var(--border)", color: "var(--text-main)",
      fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    }}>−</button>
    <span style={{ minWidth: 28, textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--accent-text)" }}>{value}</span>
    <button onClick={() => onChange(Math.min(max, value + 1))} style={{
      width: 30, height: 30, borderRadius: 8, background: "var(--surface-2)",
      border: "1px solid var(--border)", color: "var(--text-main)",
      fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    }}>+</button>
  </div>
);

// ── Planner settings ─────────────────────────────────────────────────────────
const LS_PLANNER = "planner_settings";
interface PlannerSettings { globalPersons: number; thresholds: { quick: number; normal: number }; }
const readPlannerSettings = (): PlannerSettings => {
  try { const r = localStorage.getItem(LS_PLANNER); return r ? JSON.parse(r) : { globalPersons: 2, thresholds: { quick: 20, normal: 35 } }; }
  catch { return { globalPersons: 2, thresholds: { quick: 20, normal: 35 } }; }
};

// ── Main ─────────────────────────────────────────────────────────────────────
const Settings = () => {
  const [planner, setPlanner] = useState<PlannerSettings>(readPlannerSettings);
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [needReauth, setNeedReauth] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [toast, showToast, clearToast] = useFeedbackToast(4000);

  const username = useMemo(() => localStorage.getItem("username") ?? "unknown", []);

  const handleNeedReauth = useCallback(() => setNeedReauth(true), []);

  useEffect(() => {
    if (!hasStoredJwtToken()) { setNeedReauth(true); return; }
    authApiCall<{ defaultServings?: number; quickMealMinutes?: number; normalMealMinutes?: number }>(
      API_PATHS.plannerSettings, undefined, { retries: 1, onUnauthorized: handleNeedReauth }
    ).then(data => {
      if (typeof data.defaultServings === "number" || typeof data.quickMealMinutes === "number") {
        const loaded: PlannerSettings = {
          globalPersons: typeof data.defaultServings === "number" ? data.defaultServings : planner.globalPersons,
          thresholds: {
            quick: typeof data.quickMealMinutes === "number" ? data.quickMealMinutes : planner.thresholds.quick,
            normal: typeof data.normalMealMinutes === "number" ? data.normalMealMinutes : planner.thresholds.normal,
          },
        };
        setPlanner(loaded);
        try { localStorage.setItem(LS_PLANNER, JSON.stringify(loaded)); } catch { /* ignore */ }
      }
    }).catch(() => { /* keep defaults */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleNeedReauth]);

  const updatePlanner = useCallback((updated: PlannerSettings) => {
    setPlanner(updated);
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      try { localStorage.setItem(LS_PLANNER, JSON.stringify(updated)); } catch { /* ignore */ }
      if (!hasStoredJwtToken()) return;
      const payload: PlannerSettingsPayload = {
        defaultServings: updated.globalPersons,
        quickMealMinutes: updated.thresholds.quick,
        normalMealMinutes: updated.thresholds.normal,
      };
      void authApiCall(API_PATHS.plannerSettings, {
        method: "PUT", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(payload),
      }, { retries: 1, onUnauthorized: handleNeedReauth });
    }, 500);
  }, [handleNeedReauth]);

  useEffect(() => () => { if (saveRef.current) clearTimeout(saveRef.current); }, []);

  const handlePasswordSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPw || !newPw || !confirmPw) { showToast("Please fill in all password fields.", "error"); return; }
    if (newPw.length < 4) { showToast("New password must be at least 4 characters.", "error"); return; }
    if (newPw !== confirmPw) { showToast("Passwords do not match.", "error"); return; }
    setPwSubmitting(true);
    try {
      await authApiCall(API_PATHS.changePassword, {
        method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      }, { retries: 1, onUnauthorized: handleNeedReauth });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      showToast("Password updated successfully.", "success");
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) { showToast("Current password incorrect.", "error"); return; }
      showToast("Could not update password.", "error");
    } finally { setPwSubmitting(false); }
  }, [confirmPw, currentPw, handleNeedReauth, newPw, showToast]);

  const handleSignOut = useCallback(() => {
    localStorage.removeItem("jwt_auth");
    localStorage.removeItem("username");
    window.location.href = "/";
  }, []);

  return (
    <div style={{ minHeight: "100vh", color: "var(--text-main)", fontFamily: "var(--font-body)", paddingBottom: 90 }}>
      {needReauth && <AuthPopup onAuthenticated={() => { setNeedReauth(false); }} />}
      <AppHeader username={username} />

      <div style={{ padding: "0 12px", maxWidth: 600, margin: "0 auto" }}>
        <div style={{ display: "grid", gap: 12 }}>

          {/* Account */}
          <section style={card}>
            <h2 style={sectionTitle}>Account</h2>
            <p style={sectionSub}>Signed in as <strong style={{ color: "var(--text-main)" }}>{username}</strong></p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={handleSignOut} style={{
                padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)",
                background: "var(--surface-2)", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}>Sign out</button>
              <button onClick={() => setNeedReauth(true)} style={{
                padding: "10px 16px", borderRadius: 10, border: "1px solid var(--accent-border)",
                background: "var(--accent-light)", color: "var(--accent-text)", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>Re-authenticate</button>
            </div>
          </section>

          {/* Password */}
          <section style={card}>
            <h2 style={sectionTitle}>Change Password</h2>
            <p style={sectionSub}>You'll need your current password to confirm.</p>
            <form onSubmit={handlePasswordSubmit} style={{ display: "grid", gap: 10 }}>
              {[
                { label: "Current password", val: currentPw, set: setCurrentPw },
                { label: "New password (min. 4 chars)", val: newPw, set: setNewPw },
                { label: "Confirm new password", val: confirmPw, set: setConfirmPw },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <label style={fieldLabel}>{label}</label>
                  <input
                    type="password" value={val}
                    onChange={e => set(e.currentTarget.value)}
                    style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = "var(--accent-border)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
                  />
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" disabled={pwSubmitting} style={{
                  padding: "10px 20px", borderRadius: 10, border: "none",
                  background: pwSubmitting ? "var(--accent-border)" : "var(--accent)",
                  color: "#fff", fontSize: 14, fontWeight: 600,
                  cursor: pwSubmitting ? "not-allowed" : "pointer", transition: "background 0.15s",
                }}>{pwSubmitting ? "Updating…" : "Update password"}</button>
              </div>
            </form>
          </section>

          {/* Planner settings */}
          <section style={card}>
            <h2 style={sectionTitle}>Meal Planner</h2>
            <p style={sectionSub}>Recipe management & weekly plan settings.</p>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, marginBottom: 0 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Default servings</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Applies to new plan slots.</div>
              </div>
              <Stepper value={planner.globalPersons} onChange={v => updatePlanner({ ...planner, globalPersons: v })} min={1} max={20} />
            </div>

            <div style={divider} />

            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-dim)", marginBottom: 12 }}>Day type limits (minutes)</div>

            {[
              { emoji: "⚡", label: "Quick day", sub: "Max. time for fast meals", val: planner.thresholds.quick, set: (v: number) => updatePlanner({ ...planner, thresholds: { ...planner.thresholds, quick: Math.min(v, planner.thresholds.normal - 5) } }), min: 5, max: 60 },
              { emoji: "🏠", label: "Normal day", sub: "Max. time for standard meals", val: planner.thresholds.normal, set: (v: number) => updatePlanner({ ...planner, thresholds: { ...planner.thresholds, normal: Math.max(v, planner.thresholds.quick + 5) } }), min: 10, max: 120 },
            ].map(row => (
              <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{row.emoji}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{row.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{row.sub}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Stepper value={row.val} onChange={row.set} min={row.min} max={row.max} />
                  <span style={{ fontSize: 12, color: "var(--text-dim)", minWidth: 24 }}>min</span>
                </div>
              </div>
            ))}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", opacity: 0.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>🌿</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Relaxed</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>All recipes, no limit</div>
                </div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-muted)" }}>∞</span>
            </div>
          </section>
        </div>
      </div>

      <FeedbackToast toast={toast} onDismiss={clearToast} />
      <BottomTabBar />
    </div>
  );
};

export default memo(Settings);
