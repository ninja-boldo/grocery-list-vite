import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

export default function Index() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [ean, setEan] = useState("");
  const [datatype, setDatatype] = useState("");
  const [count, setCount] = useState(1);
  const [sending, setSending] = useState(false);

  // toast state
  const [toast, setToast] = useState<{
    message: string;
    success: boolean;
  } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (success: boolean, message: string) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ message, success });
      toastOpacity.setValue(0);
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setToast(null));
      }, 2200);
    },
    [toastOpacity],
  );

  const resetScanner = useCallback(() => {
    setScanned(false);
    setEan("");
    setDatatype("");
    setCount(1);
  }, []);

  const sendEan = useCallback(async () => {
    if (sending) return;
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    resetScanner();

    try {
      const resp = await fetch("https://boldo.ddns.net/api/add_ean_to_list/", {
        method: "POST",
        body: JSON.stringify({
          ean,
          count,
          subgroups: "",
          wish_list: "false",
        }),
        headers: { "Content-type": "application/json; charset=UTF-8" },
      });

      if (resp.ok) {
        const data = await resp.json();
        const ok =
          data.known_to_db === true &&
          String(data.detail ?? "").toLowerCase() !== "failed to add item";
        if (ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showToast(true, `Added ${data.name}`);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast(false, String(data.detail || "EAN not found"));
        }
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast(false, `Server error ${resp.status}`);
      }
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(false, "Network error");
    } finally {
      setSending(false);
    }
  }, [count, ean, sending, showToast]);

  // ── Permission screens ───────────────────────────────────────────────
  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionScreen}>
        <Text style={styles.permissionTitle}>Camera Access</Text>
        <Text style={styles.permissionBody}>
          Allow camera access to scan barcodes
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.permissionBtn,
            pressed && { opacity: 0.8 },
          ]}
          onPress={requestPermission}
        >
          <Text style={styles.permissionBtnText}>Allow Camera</Text>
        </Pressable>
      </View>
    );
  }

  // ── Main scanner ─────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8"] }}
        onBarcodeScanned={
          scanned
            ? undefined
            : ({ type, data }) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setDatatype(type);
                setEan(data);
                setScanned(true);
              }
        }
      />

      {/* Scan-line hint when idle */}
      {!scanned && (
        <View style={styles.idleHint}>
          <View style={styles.crosshair} />
          <Text style={styles.idleText}>Point at a barcode</Text>
        </View>
      )}

      {/* Toast */}
      {toast && (
        <Animated.View
          style={[
            styles.toast,
            toast.success ? styles.toastSuccess : styles.toastError,
            { opacity: toastOpacity },
          ]}
        >
          <Text style={styles.toastIcon}>{toast.success ? "✓" : "✕"}</Text>
          <Text
            style={[
              styles.toastText,
              { color: toast.success ? "#065f46" : "#991b1b" },
            ]}
          >
            {toast.message}
          </Text>
        </Animated.View>
      )}

      {/* Scanned bottom sheet */}
      {scanned && (
        <View style={styles.sheet}>
          {/* EAN info row */}
          <View style={styles.eanRow}>
            <View>
              <Text style={styles.eanLabel}>{datatype.toUpperCase()}</Text>
              <Text style={styles.eanValue}>{ean}</Text>
            </View>
          </View>

          {/* Count stepper */}
          <View style={styles.stepperRow}>
            <Text style={styles.stepperLabel}>Quantity</Text>
            <View style={styles.stepper}>
              <Pressable
                style={({ pressed }) => [
                  styles.stepBtn,
                  pressed && styles.stepBtnPressed,
                  count <= 1 && { opacity: 0.3 },
                ]}
                disabled={count <= 1}
                onPress={() => {
                  Haptics.selectionAsync();
                  setCount((p) => Math.max(1, p - 1));
                }}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepCount}>{count}</Text>
              <Pressable
                style={({ pressed }) => [
                  styles.stepBtn,
                  pressed && styles.stepBtnPressed,
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setCount((p) => p + 1);
                }}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.btnPrimary,
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                sending && { opacity: 0.5 },
              ]}
              disabled={sending}
              onPress={sendEan}
            >
              <Text style={styles.btnPrimaryText}>
                {sending ? "Sending…" : "Add to List"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
const GLASS = "rgba(20,20,20,0.72)";
const RADIUS = 20;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },

  // permission
  permissionScreen: {
    flex: 1,
    backgroundColor: "#111",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 8,
  },
  permissionBody: {
    fontSize: 15,
    color: "#aaa",
    textAlign: "center",
    marginBottom: 24,
  },
  permissionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    backgroundColor: "#fff",
    borderRadius: 14,
  },
  permissionBtnText: { fontSize: 15, fontWeight: "700", color: "#111" },

  // idle
  idleHint: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  crosshair: {
    width: 200,
    height: 200,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    marginBottom: 16,
  },
  idleText: { fontSize: 14, color: "rgba(255,255,255,0.6)" },

  // toast
  toast: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  toastSuccess: { backgroundColor: "#d1fae5" },
  toastError: { backgroundColor: "#fee2e2" },
  toastIcon: { fontSize: 16, fontWeight: "700" },
  toastText: { fontSize: 13, fontWeight: "600" },

  // bottom sheet
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: GLASS,
    borderTopLeftRadius: RADIUS,
    borderTopRightRadius: RADIUS,
    paddingTop: 20,
    paddingBottom: 36,
    paddingHorizontal: 20,
    gap: 16,
    // blur fallback shadow
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },

  eanRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eanLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 1,
    marginBottom: 2,
  },
  eanValue: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 1.5,
  },

  stepperRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stepperLabel: { fontSize: 14, color: "rgba(255,255,255,0.6)" },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    gap: 2,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnPressed: { backgroundColor: "rgba(255,255,255,0.15)" },
  stepBtnText: { fontSize: 20, fontWeight: "600", color: "#fff" },
  stepCount: {
    minWidth: 32,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },

  actions: { flexDirection: "row", gap: 10 },
  btnSecondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  btnSecondaryText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  btnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  btnPrimaryText: { fontSize: 15, fontWeight: "700", color: "#111" },
});
