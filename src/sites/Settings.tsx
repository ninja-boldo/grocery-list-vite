import { memo, useCallback, useEffect, useMemo, useState, useRef } from "react";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: "#161b22",
  border: "1px solid #21262d",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 8px 32px #00000060",
};

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid #2a313b",
  backgroundColor: "#0d1117",
  color: "#e6edf3",
  padding: "10px 12px",
  outline: "none",
  fontSize: 14,
};

const BTN_PRIMARY: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid #0d948850",
  backgroundColor: "#0f2a28",
  color: "#5eead4",
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s",
  minHeight: 38,
};

const BTN_SECONDARY: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid #21262d",
  backgroundColor: "#161b22",
  color: "#8b949e",
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s",
  minHeight: 38,
};

// ─── Planner settings helpers ─────────────────────────────────────────────────
const LS_PLANNER = "planner_settings";

interface PlannerSettings { globalPersons: number; thresholds: { quick: number; normal: number }; }

const readPlannerSettings = (): PlannerSettings => {
  try { const raw = localStorage.getItem(LS_PLANNER); return raw ? JSON.parse(raw) : { globalPersons: 2, thresholds: { quick: 20, normal: 35 } }; }
  catch { return { globalPersons: 2, thresholds: { quick: 20, normal: 35 } }; }
};

// Small stepper atom (self-contained, no external dependency)
const SettingsStepper = ({ value, onChange, min = 1, max = 99, compact = true }: { value: number; onChange: (v: number) => void; min?: number; max?: number; compact?: boolean }) => (
  <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 10 }}>
    <button onClick={() => onChange(Math.max(min, value - 1))}
      style={{ width: 28, height: 28, borderRadius: 8, background: "#21262d", border: "1px solid #2a313b", color: "#e6edf3", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>−</button>
    <span style={{ minWidth: 28, textAlign: "center", fontSize: 15, fontWeight: 700, color: "#5eead4" }}>{value}</span>
    <button onClick={() => onChange(Math.min(max, value + 1))}
      style={{ width: 28, height: 28, borderRadius: 8, background: "#21262d", border: "1px solid #2a313b", color: "#e6edf3", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>+</button>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────

const Settings = () => {
  // Planner settings
  const [plannerSettings, setPlannerSettings] = useState<PlannerSettings>(readPlannerSettings);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePlanner = useCallback((updated: PlannerSettings) => {
    setPlannerSettings(updated);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try { localStorage.setItem(LS_PLANNER, JSON.stringify(updated)); } catch { /* ignore */ }
    }, 300);
  }, []);

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);
  const [needReauth, setNeedReauth] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusVariant, setStatusVariant] = useState<"ok" | "error">("ok");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  const username = useMemo(
    () => localStorage.getItem("username") ?? "unknown",
    [],
  );

  useEffect(() => {
    if (!hasStoredJwtToken()) {
      setNeedReauth(true);
    }
  }, []);

  const handleNeedReauth = useCallback(() => {
    setNeedReauth(true);
    setStatusVariant("error");
    setStatusMessage("Authentication required. Please sign in again.");
  }, []);

  const handlePasswordSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (!currentPassword || !newPassword || !confirmPassword) {
        setStatusVariant("error");
        setStatusMessage("Please fill in all password fields.");
        return;
      }

      if (newPassword.length < 4) {
        setStatusVariant("error");
        setStatusMessage("New password must be at least 4 characters.");
        return;
      }

      if (newPassword !== confirmPassword) {
        setStatusVariant("error");
        setStatusMessage("New password and confirmation do not match.");
        return;
      }

      setIsSubmittingPassword(true);
      setStatusMessage(null);

      try {
        await authApiCall(
          "/api/change_password",
          {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({
              current_password: currentPassword,
              new_password: newPassword,
            }),
          },
          { retries: 1, onUnauthorized: handleNeedReauth },
        );

        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setStatusVariant("ok");
        setStatusMessage("Password updated successfully.");
      } catch (err) {
        if (err instanceof Error && err.message.includes("401")) {
          setStatusVariant("error");
          setStatusMessage("Current password is incorrect or session expired.");
          return;
        }
        setStatusVariant("error");
        setStatusMessage("Could not update password. Please try again.");
      } finally {
        setIsSubmittingPassword(false);
      }
    },
    [confirmPassword, currentPassword, handleNeedReauth, newPassword],
  );

  const handleSignOut = useCallback(() => {
    localStorage.removeItem("jwt_auth");
    localStorage.removeItem("username");
    setNeedReauth(true);
    setStatusVariant("ok");
    setStatusMessage("Signed out. Please authenticate again.");
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0D1117",
        color: "#E8EDF2",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        paddingBottom: 90,
      }}
    >
      {needReauth && (
        <AuthPopup
          onAuthenticated={() => {
            setNeedReauth(false);
            setStatusMessage(null);
          }}
        />
      )}

      <AppHeader username={username} />

      <div style={{ padding: "0 12px" }}>
        <div className="max-w-5xl mx-auto" style={{ display: "grid", gap: 14 }}>
          {statusMessage && (
            <div
              style={{
                ...CARD_STYLE,
                borderColor: statusVariant === "ok" ? "#0d948850" : "#ef444430",
                color: statusVariant === "ok" ? "#5eead4" : "#fca5a5",
                fontSize: 13,
              }}
            >
              {statusMessage}
            </div>
          )}

          <section style={CARD_STYLE}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#5eead4" }}>
              Account
            </h2>
            <p style={{ margin: "6px 0 14px", fontSize: 12, color: "#8b949e" }}>
              Logged in as{" "}
              <strong style={{ color: "#e6edf3" }}>{username}</strong>
            </p>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={handleSignOut} style={BTN_SECONDARY}>
                Sign out
              </button>
              <button onClick={() => setNeedReauth(true)} style={BTN_PRIMARY}>
                Re-authenticate
              </button>
            </div>
          </section>

          {/* ── Wochenplaner ── */}
          <section style={CARD_STYLE}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#5eead4" }}>Wochenplaner</h2>
            <p style={{ margin: "6px 0 14px", fontSize: 12, color: "#8b949e" }}>
              Einstellungen für Rezeptverwaltung und Wochenplan.
            </p>

            {/* Standardportionen */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid #21262d" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#e6edf3" }}>Standardportionen</div>
                <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>Gilt für neue Wochenplan-Slots. Pro Slot überschreibbar.</div>
              </div>
              <SettingsStepper
                value={plannerSettings.globalPersons}
                onChange={(v) => updatePlanner({ ...plannerSettings, globalPersons: v })}
                min={1} max={20}
              />
            </div>

            {/* Tagestyp-Grenzen */}
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#4A5568", marginBottom: 10 }}>Tagestyp-Grenzen (Min.)</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>⚡</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>Schnelltag</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Max. Zeit für schnelle Gerichte</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <SettingsStepper
                  value={plannerSettings.thresholds.quick}
                  onChange={(v) => updatePlanner({ ...plannerSettings, thresholds: { ...plannerSettings.thresholds, quick: Math.min(v, plannerSettings.thresholds.normal - 5) } })}
                  min={5} max={60}
                />
                <span style={{ fontSize: 12, color: "#8b949e", minWidth: 24 }}>min</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🏠</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>Normaltag</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Max. Zeit für normale Gerichte</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <SettingsStepper
                  value={plannerSettings.thresholds.normal}
                  onChange={(v) => updatePlanner({ ...plannerSettings, thresholds: { ...plannerSettings.thresholds, normal: Math.max(v, plannerSettings.thresholds.quick + 5) } })}
                  min={10} max={120}
                />
                <span style={{ fontSize: 12, color: "#8b949e", minWidth: 24 }}>min</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", opacity: 0.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🌿</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>Entspannt</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Alle Rezepte, keine Begrenzung</div>
                </div>
              </div>
              <span style={{ fontSize: 13, color: "#8b949e", fontWeight: 700 }}>∞</span>
            </div>
          </section>

          <section style={CARD_STYLE}>
            <h2 style={{ margin: 0, fontSize: 16, color: "#5eead4" }}>
              Password
            </h2>
            <p style={{ margin: "6px 0 14px", fontSize: 12, color: "#8b949e" }}>
              Update your password. You need your current password to confirm
              this change.
            </p>

            <form
              onSubmit={handlePasswordSubmit}
              style={{ display: "grid", gap: 10 }}
            >
              <input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(event) =>
                  setCurrentPassword(event.currentTarget.value)
                }
                style={FIELD_STYLE}
              />
              <input
                type="password"
                placeholder="New password (min. 4 chars)"
                value={newPassword}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
                style={FIELD_STYLE}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.currentTarget.value)
                }
                style={FIELD_STYLE}
              />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  style={BTN_PRIMARY}
                  disabled={isSubmittingPassword}
                >
                  {isSubmittingPassword ? "Updating..." : "Update password"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      <BottomTabBar />
    </div>
  );
};

export default memo(Settings);
