import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import QuantityRequiredModal from "@/comp/utils/QuantityRequiredModal";
import { hasStoredJwtToken } from "@/lib/authApi";
import { apiClient } from "@/lib/api/client";
import { isAddEanSuccess, needsQuantityDetails } from "@/lib/api/addEanFlow";
import { useTranslation } from "react-i18next";
import i18next from "i18next";

// ── Palette ─────────────────────────────────────────────────────────────────
const P = {
  bg: "transparent",
  surface: i18next.t("rgba163846082", "rgba(16, 38, 46, 0.82)"),
  border: i18next.t("rgba130177188028", "rgba(130, 177, 188, 0.28)"),
  teal: "#1D9E75",
  tealD: "#0f2a28",
  tealB: "#0d948850",
  text: i18next.t("ecf7f8", "#ecf7f8"),
  muted: "#9ab4b8",
  subtle: "#6f8b91",
  red: "#ef4444",
  redD: "#2a1111",
  redB: "#ef444430",
} as const;

type ScanMode = "auto" | "manual";

type PendingQuantity = {
  ean: string | null;
  itemName: string;
  count: number;
  wish_list: string;
};

const QUANTITY_UNITS = [
  "g",
  "kg",
  "ml",
  "L",
  "Stück",
  "cl",
  "EL",
  "TL",
] as const;

type ScanResult = {
  ean?: string;
  itemName?: string;
  detail: string;
  known: boolean;
  count: number;
  isAdd: boolean;
  isWish: boolean;
};

export default function ImprovedScanner() {
  const { t } = useTranslation();
  const navHook = useNavigate();
  const location = useLocation();

  const queryParams = new URLSearchParams(location.search);
  const count = queryParams.get("count") || "1";
  const isWishList = queryParams.get("wishlist") === "true";

  const [headline, setHeadline] = useState("");
  const [mode, setMode] = useState<ScanMode>("auto");
  const [ean, setEan] = useState("");
  const [manualEan, setManualEan] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualQuantity, setManualQuantity] = useState(1);
  const [scanQuantity, setScanQuantity] = useState(1);
  const [inputMode, setInputMode] = useState<"ean" | "name">("name");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [verbose, setVerbose] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [lastScanTime, setLastScanTime] = useState<string>("");
  const [scannedCode, setScannedCode] = useState<string>("");
  const [needReauth, setNeedReauth] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [pendingQuantity, setPendingQuantity] =
    useState<PendingQuantity | null>(null);
  const [qtyAmount, setQtyAmount] = useState<string>("100");
  const [qtyUnit, setQtyUnit] = useState<string>("g");
  const [qtySaving, setQtySaving] = useState(false);

  const scanLockRef = useRef(false);
  const lastSentRef = useRef<{ ean?: string; ts?: number }>({});
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scannerIdRef = useRef("qr-reader");
  const quantityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanSubmitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const log = useCallback(
    (message: string, data?: unknown) => {
      if (verbose) {
        console.log(`[Scanner] ${message}`, data || "");
      }
    },
    [verbose],
  );

  useEffect(() => {
    if (!hasStoredJwtToken()) {
      setNeedReauth(true);
    }
  }, []);

  const handleNeedReauth = useCallback(() => {
    setNeedReauth(true);
    setError("Authentication required. Please sign in again.");
  }, []);

  const showResult = useCallback((result: ScanResult) => {
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    setScanResult(result);
    resultTimeoutRef.current = setTimeout(() => setScanResult(null), 6000);
  }, []);

  const hardStopCamera = async () => {
    const qr = html5QrCodeRef.current;
    if (!qr) return;
    try {
      if (qr.isScanning) await qr.stop();
      const videoElem = document.querySelector("video");
      const stream = videoElem?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
      if (videoElem) videoElem.srcObject = null;
    } catch (e) {
      console.warn("Hard stop failed:", e);
    } finally {
      html5QrCodeRef.current = null;
    }
  };

  const sendEan = useCallback(
    async (eanToSend: string, quantityToSend?: number) => {
      const now = Date.now();
      if (
        lastSentRef.current.ean === eanToSend &&
        now - (lastSentRef.current.ts || 0) < 1000
      ) {
        log(
          t("skippingDuplicateSendFor", "Skipping duplicate send for"),
          eanToSend,
        );
        return;
      }
      lastSentRef.current = { ean: eanToSend, ts: now };

      const parsedModeCount = Number(count);
      const finalCount = Number.isFinite(parsedModeCount) ? parsedModeCount : 1;
      const requestCount =
        typeof quantityToSend === "number" ? quantityToSend : finalCount;

      try {
        const data = await apiClient.addEanToList(
          {
            ean: eanToSend,
            count: requestCount,
            wish_list: String(isWishList),
          },
          {
            retries: 1,
            retryDelayMs: 300,
            onUnauthorized: handleNeedReauth,
          },
        );

        const isSuccess = isAddEanSuccess(data);
        const needsQuantity = needsQuantityDetails(data);

        if (isSuccess) {
          setShowSuccess(true);
          setTimeout(() => setShowSuccess(false), 2500);
          showResult({
            ean: eanToSend,
            itemName: data.item_name ?? data.product_name,
            detail:
              data.detail ??
              t("itemProcessedSuccessfully", "Item processed successfully"),
            known: true,
            count: requestCount,
            isAdd: requestCount > 0,
            isWish: isWishList,
          });
        } else if (needsQuantity) {
          setPendingQuantity({
            ean: eanToSend,
            itemName: data.item_name ?? data.product_name ?? eanToSend,
            count: requestCount,
            wish_list: String(isWishList),
          });
          setQtyAmount("1");
          setQtyUnit("Stück");
        } else {
          setError("EAN not found in database");
          showResult({
            ean: eanToSend,
            detail: data.detail ?? t("eanNotRecognized", "EAN not recognized"),
            known: false,
            count: requestCount,
            isAdd: requestCount > 0,
            isWish: isWishList,
          });
          setTimeout(() => setError(""), 2500);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("401")) return;
        setError("Network error");
        console.error("Network error:", err);
        setTimeout(() => setError(""), 2500);
      }
    },
    [count, handleNeedReauth, isWishList, log, showResult],
  );

  const sendByName = useCallback(
    async (itemName: string, quantityToSend: number) => {
      try {
        const data = await apiClient.addEanToList(
          {
            item_name: itemName,
            count: quantityToSend,
            wish_list: String(isWishList),
          },
          {
            retries: 1,
            retryDelayMs: 300,
            onUnauthorized: handleNeedReauth,
          },
        );

        if (needsQuantityDetails(data)) {
          setPendingQuantity({
            ean: null,
            itemName,
            count: quantityToSend,
            wish_list: String(isWishList),
          });
          setQtyAmount("1");
          setQtyUnit("Stück");
          return;
        }

        if (!isAddEanSuccess(data)) {
          setError("Failed to add item");
          return;
        }

        if ("vibrate" in navigator) {
          try {
            navigator.vibrate(200);
          } catch {
            /* ignore */
          }
        }

        showResult({
          itemName,
          detail: t("itemnameAddedToVal", '"{{itemName}}" added to {{val}}', {
            itemName,
            val: isWishList ? "wish list" : "inventory",
          }),
          known: true,
          count: quantityToSend,
          isAdd: true,
          isWish: isWishList,
        });
        setManualName("");
      } catch (err) {
        if (err instanceof Error && err.message.includes("401")) return;
        console.error("Error sending item:", err);
        setError("Failed to add item");
      }
    },
    [handleNeedReauth, isWishList, showResult],
  );

  const saveWithQuantity = useCallback(async () => {
    if (!pendingQuantity) return;
    const amount = parseFloat(qtyAmount);
    if (!isFinite(amount) || amount <= 0) {
      setError("Please enter a valid quantity");
      setTimeout(() => setError(""), 2500);
      return;
    }
    setQtySaving(true);
    let completed = false;
    try {
      const response = await apiClient.addEanToList(
        {
          ean: pendingQuantity.ean,
          item_name: pendingQuantity.itemName,
          count: pendingQuantity.count,
          wish_list: pendingQuantity.wish_list,
          quantity_data: {
            product_quantity: amount,
            product_quantity_unit: qtyUnit,
          },
        },
        {
          retries: 1,
          retryDelayMs: 300,
          onUnauthorized: handleNeedReauth,
        },
      );

      if (needsQuantityDetails(response)) {
        setError("The server still needs quantity details.");
        setTimeout(() => setError(""), 2500);
        return;
      }

      if (!isAddEanSuccess(response)) {
        setError("Failed to add item");
        setTimeout(() => setError(""), 2500);
        return;
      }

      showResult({
        ean: pendingQuantity.ean,
        itemName: pendingQuantity.itemName,
        detail: t("addedWithQuantity", "Added with quantity"),
        known: true,
        count: pendingQuantity.count,
        isAdd: pendingQuantity.count > 0,
        isWish: pendingQuantity.wish_list === "true",
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);
      completed = true;
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("401"))) {
        setError("Failed to add item");
        setTimeout(() => setError(""), 2500);
      }
    } finally {
      setQtySaving(false);
      if (completed) {
        setPendingQuantity(null);
      }
    }
  }, [handleNeedReauth, pendingQuantity, qtyAmount, qtyUnit, showResult]);

  const handleQuantityChange = (delta: number, isScanner = false) => {
    if (isScanner) {
      setScanQuantity((prev) => Math.max(1, prev + delta));
    } else {
      setManualQuantity((prev) => Math.max(1, prev + delta));
      if (quantityTimeoutRef.current) clearTimeout(quantityTimeoutRef.current);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (quantityTimeoutRef.current) clearTimeout(quantityTimeoutRef.current);

    if (inputMode === "ean") {
      if (manualEan && /^\d{8,14}$/.test(manualEan)) {
        sendEan(manualEan, manualQuantity);
      } else {
        setError("Please enter a valid barcode (8-14 digits)");
        setTimeout(() => setError(""), 2500);
      }
    } else {
      if (manualName.trim()) {
        sendByName(manualName.trim(), manualQuantity);
      } else {
        setError("Please enter an item name");
        setTimeout(() => setError(""), 3000);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (quantityTimeoutRef.current) clearTimeout(quantityTimeoutRef.current);
      if (scanSubmitTimeoutRef.current)
        clearTimeout(scanSubmitTimeoutRef.current);
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const deleteFrom = isWishList ? "wish" : "item";
    const newHeadline =
      count === "1"
        ? t("addDeletefrom", "Add {{deleteFrom}}", { deleteFrom })
        : t("removeDeletefrom", "Remove {{deleteFrom}}", { deleteFrom });
    setHeadline(newHeadline);
    if (mode !== "auto") return;

    const startScanner = async () => {
      try {
        log("Initializing HTML5 QR Code scanner");
        const html5QrCode = new Html5Qrcode(scannerIdRef.current);
        html5QrCodeRef.current = html5QrCode;

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        };

        const onScanSuccess = (decodedText: string) => {
          setScanCount((prev) => prev + 1);
          setLastScanTime(new Date().toLocaleTimeString());
          log("Scan success", decodedText);
          if (scanLockRef.current) return;
          scanLockRef.current = true;
          if (/^\d{8,14}$/.test(decodedText)) {
            setEan(decodedText);
            setScannedCode(decodedText);
            setScanning(false);
            setTimeout(() => {
              scanLockRef.current = false;
            }, 1000);
          } else {
            log(
              t("invalidBarcodeFormat", "Invalid barcode format"),
              decodedText,
            );
          }
        };

        const onScanError = (errorMessage: string) => {
          if (verbose)
            log(
              t(
                "scanErrorNormalDuringScanning",
                "Scan error (normal during scanning)",
              ),
              errorMessage,
            );
        };

        try {
          await html5QrCode.start(
            { facingMode: "environment" },
            config,
            onScanSuccess,
            onScanError,
          );
          setScanning(true);
          setError("");
          log("Scanner started with rear camera");
        } catch (err) {
          log(
            t(
              "rearCameraFailedTryingAnyCamera",
              "Rear camera failed, trying any camera",
            ),
            err,
          );
          try {
            const devices = await Html5Qrcode.getCameras();
            if (devices && devices.length > 0) {
              await html5QrCode.start(
                devices[0].id,
                config,
                onScanSuccess,
                onScanError,
              );
              setScanning(true);
              setError("");
              log("Scanner started with fallback camera");
            } else {
              throw new Error("No cameras found");
            }
          } catch (fallbackErr) {
            console.error("Camera initialization failed:", fallbackErr);
            setError("Camera access failed. Try manual mode.");
          }
        }
      } catch (err) {
        console.error("Scanner initialization error:", err);
        setError("Scanner initialization failed. Try manual mode.");
      }
    };

    startScanner();

    return () => {
      log("Cleaning up HTML5 QR Code scanner");
      if (html5QrCodeRef.current?.isScanning) {
        html5QrCodeRef.current
          .stop()
          .catch((err) => console.error("Error stopping scanner:", err));
      }
    };
  }, [mode, sendEan, log, verbose, scanQuantity]);

  // ── Style helpers ─────────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 12px",
    backgroundColor: P.bg,
    border: t("1pxSolidBorder", "1px solid {{border}}", { border: P.border }),
    borderRadius: 10,
    color: P.text,
    fontSize: 14,
    outline: "none",
    transition: "border-color 0.15s",
  };

  const qtyBtnStyle = (isPlus: boolean): React.CSSProperties => ({
    all: "unset" as const,
    boxSizing: "border-box" as const,
    width: 44,
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    fontSize: 22,
    fontWeight: 300,
    cursor: "pointer",
    backgroundColor: isPlus ? P.tealD : P.surface,
    border: t("1pxSolidVal", "1px solid {{val}}", {
      val: isPlus ? P.tealB : P.border,
    }),
    color: isPlus ? "#5eead4" : P.muted,
    transition: t("all015s", "all 0.15s"),
    flexShrink: 0,
  });

  const submitBtnStyle: React.CSSProperties = {
    all: "unset" as const,
    boxSizing: "border-box" as const,
    display: "block",
    width: "100%",
    textAlign: "center" as const,
    marginTop: 12,
    padding: "10px 0",
    backgroundColor: P.tealD,
    border: t("1pxSolidTealb", "1px solid {{tealB}}", { tealB: P.tealB }),
    borderRadius: 10,
    color: "#5eead4",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: t("all015s", "all 0.15s"),
  };

  const username = localStorage.getItem("username") ?? "L";

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: P.bg,
        color: P.text,
        fontFamily: "var(--font-body)",
        paddingBottom: 90,
      }}
    >
      {needReauth && (
        <AuthPopup
          onAuthenticated={() => {
            setNeedReauth(false);
            setError("");
          }}
        />
      )}

      <AppHeader username={username} />

      <div className="p-3 sm:p-4 md:p-6">
        <div className="max-w-lg mx-auto">
          {/* Title row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
            }}
          >
            {/* Back */}
            <button
              onClick={async () => {
                await hardStopCamera();
                navHook(-1 as never);
              }}
              style={{
                all: "unset",
                boxSizing: "border-box",
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: P.surface,
                border: `1px solid ${P.border}`,
                borderRadius: 9,
                color: P.muted,
                cursor: "pointer",
                flexShrink: 0,
                transition: "all 0.15s",
                fontSize: 16,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = P.text;
                (e.currentTarget as HTMLElement).style.borderColor = P.tealB;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = P.muted;
                (e.currentTarget as HTMLElement).style.borderColor = P.border;
              }}
              aria-label={t("back", "Back")}
            >
              ‹
            </button>

            {/* Headline */}
            <span
              style={{
                flex: 1,
                color: P.text,
                fontSize: 14,
                fontWeight: 600,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {headline}
              {isWishList && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    color: P.muted,
                    fontWeight: 400,
                  }}
                >
                  {t("wishList2", "· Wish List")}
                </span>
              )}
            </span>

            {/* Mode toggle */}
            <div
              style={{
                display: "flex",
                gap: 2,
                backgroundColor: P.surface,
                padding: 3,
                borderRadius: 10,
                border: `1px solid ${P.border}`,
                flexShrink: 0,
              }}
            >
              {(["auto", "manual"] as ScanMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    all: "unset",
                    boxSizing: "border-box",
                    padding: "5px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    backgroundColor: mode === m ? P.tealD : "transparent",
                    border: `1px solid ${mode === m ? P.tealB : "transparent"}`,
                    color: mode === m ? "#5eead4" : P.muted,
                  }}
                >
                  {m === "auto" ? "Auto" : "Manual"}
                </button>
              ))}
            </div>

            {/* Verbose toggle */}
            <button
              onClick={() => setVerbose(!verbose)}
              style={{
                all: "unset",
                boxSizing: "border-box",
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: verbose ? P.tealD : P.surface,
                border: `1px solid ${verbose ? P.tealB : P.border}`,
                borderRadius: 9,
                color: verbose ? "#5eead4" : P.muted,
                cursor: "pointer",
                flexShrink: 0,
                transition: "all 0.15s",
              }}
              title={t("toggleVerboseLogging", "Toggle verbose logging")}
            >
              <svg
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
          </div>

          {/* ── Scan result card ── */}
          {scanResult && (
            <div
              style={{
                backgroundColor: scanResult.known ? P.tealD : P.redD,
                border: `1px solid ${scanResult.known ? P.tealB : P.redB}`,
                borderRadius: 14,
                padding: "14px 16px",
                marginBottom: 12,
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  backgroundColor: scanResult.known ? "#0f2a28" : "#3a1010",
                  border: `1px solid ${scanResult.known ? P.tealB : P.redB}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {scanResult.known ? (
                  <svg
                    width="14"
                    height="14"
                    fill="none"
                    stroke="#5eead4"
                    viewBox="0 0 24 24"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    fill="none"
                    stroke="#f87171"
                    viewBox="0 0 24 24"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}
              </div>

              {/* Details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: scanResult.known ? "#5eead4" : "#f87171",
                    marginBottom: 4,
                  }}
                >
                  {scanResult.known
                    ? scanResult.isAdd
                      ? t("addedToVal", "Added to {{val}}", {
                          val: scanResult.isWish ? "Wish List" : "Inventory",
                        })
                      : t("removedFromVal", "Removed from {{val}}", {
                          val: scanResult.isWish ? "Wish List" : "Inventory",
                        })
                    : t("notRecognized", "Not recognized")}
                </div>

                {scanResult.itemName && (
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: P.text,
                      marginBottom: 3,
                    }}
                  >
                    {scanResult.itemName}
                  </div>
                )}

                <div style={{ fontSize: 12, color: P.muted }}>
                  {scanResult.detail}
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                  {scanResult.ean && (
                    <span
                      style={{
                        fontSize: 11,
                        color: P.subtle,
                        fontFamily: "monospace",
                      }}
                    >
                      {t("eanEan", "EAN {{ean}}", { ean: scanResult.ean })}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: P.subtle }}>
                    {t("count", "× {{count}}", { count: scanResult.count })}
                  </span>
                </div>
              </div>

              {/* Dismiss */}
              <button
                onClick={() => setScanResult(null)}
                style={{
                  all: "unset",
                  color: P.muted,
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  flexShrink: 0,
                  padding: "0 2px",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.color = P.text)
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.color = P.muted)
                }
              >
                ×
              </button>
            </div>
          )}

          {mode === "auto" ? (
            /* ── Auto scanner ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Camera card */}
              <div
                style={{
                  backgroundColor: P.surface,
                  border: `1px solid ${P.border}`,
                  borderRadius: 18,
                  padding: 16,
                  boxShadow: "0 8px 32px #00000060",
                }}
              >
                <div
                  id={scannerIdRef.current}
                  style={{
                    borderRadius: 12,
                    overflow: "hidden",
                    border: `2px solid ${P.tealB}`,
                    backgroundColor: "#000",
                    minHeight: 280,
                  }}
                />
                {/* Status */}
                <div style={{ marginTop: 10, textAlign: "center" }}>
                  {showSuccess ? (
                    <span
                      style={{
                        color: "#5eead4",
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    >
                      {t("addedSuccessfully", "✓ Added successfully!")}
                    </span>
                  ) : error ? (
                    <span style={{ color: "#f87171", fontSize: 13 }}>
                      {error}
                    </span>
                  ) : ean ? (
                    <span
                      style={{
                        color: "#5eead4",
                        fontSize: 13,
                        fontFamily: "monospace",
                      }}
                    >
                      {t("codeEan", "Code: {{ean}}", { ean })}
                    </span>
                  ) : scanning ? (
                    <span style={{ color: P.muted, fontSize: 13 }}>
                      {t("scanning", "● Scanning...")}
                    </span>
                  ) : (
                    <span style={{ color: P.subtle, fontSize: 13 }}>
                      {t("pointAtBarcode", "Point at barcode")}
                    </span>
                  )}
                </div>
                {verbose && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "7px 10px",
                      backgroundColor: P.bg,
                      borderRadius: 8,
                      border: `1px solid ${P.tealB}`,
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: 11,
                        color: P.teal,
                        fontFamily: "monospace",
                      }}
                    >
                      {t("scansScancountLast", "Scans: {{scanCount}} | Last:", {
                        scanCount,
                      })}
                      {lastScanTime || "N/A"} {t("status", "| Status:")}{" "}
                      {scanning ? "Active" : "Stopped"}
                    </p>
                  </div>
                )}
              </div>

              {/* Scanned code quantity + submit */}
              {scannedCode && (
                <div
                  style={{
                    backgroundColor: P.surface,
                    border: `1px solid ${P.tealB}`,
                    borderRadius: 18,
                    padding: 16,
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 12px",
                      textAlign: "center",
                      color: "#5eead4",
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {t("adjustQuantity", "Adjust Quantity")}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      justifyContent: "center",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(-1, true)}
                      style={qtyBtnStyle(false)}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      value={scanQuantity}
                      onChange={(e) =>
                        setScanQuantity(
                          Math.max(1, parseInt(e.target.value) || 1),
                        )
                      }
                      min="1"
                      style={{
                        width: 80,
                        padding: "10px 8px",
                        backgroundColor: P.bg,
                        border: `2px solid ${P.tealB}`,
                        borderRadius: 10,
                        color: P.text,
                        fontSize: 26,
                        fontWeight: 700,
                        textAlign: "center",
                        outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(1, true)}
                      style={qtyBtnStyle(true)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (scanSubmitTimeoutRef.current)
                        clearTimeout(scanSubmitTimeoutRef.current);
                      sendEan(scannedCode, scanQuantity);
                    }}
                    style={submitBtnStyle}
                  >
                    {t("submit", "Submit")}
                  </button>
                </div>
              )}

              <p style={{ textAlign: "center", color: P.subtle, fontSize: 12 }}>
                {t(
                  "positionBarcodeInTheCenterOfTheFrame",
                  "Position barcode in the center of the frame",
                )}
              </p>
            </div>
          ) : (
            /* ── Manual entry ── */
            <div
              style={{
                backgroundColor: P.surface,
                border: `1px solid ${P.border}`,
                borderRadius: 18,
                padding: "20px 16px",
                boxShadow: "0 8px 32px #00000060",
              }}
            >
              {/* Input mode toggle */}
              <div
                style={{
                  display: "flex",
                  gap: 2,
                  backgroundColor: P.bg,
                  padding: 3,
                  borderRadius: 10,
                  border: `1px solid ${P.border}`,
                  marginBottom: 16,
                }}
              >
                {(["name", "ean"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setInputMode(m)}
                    style={{
                      all: "unset",
                      boxSizing: "border-box",
                      flex: 1,
                      padding: "6px 0",
                      textAlign: "center",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all 0.15s",
                      backgroundColor:
                        inputMode === m ? P.tealD : "transparent",
                      border: `1px solid ${inputMode === m ? P.tealB : "transparent"}`,
                      color: inputMode === m ? "#5eead4" : P.muted,
                    }}
                  >
                    {m === "name" ? "By Name" : "By Barcode"}
                  </button>
                ))}
              </div>

              <form
                onSubmit={handleManualSubmit}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                {inputMode === "name" ? (
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: P.muted,
                        marginBottom: 6,
                      }}
                    >
                      {t("itemName2", "Item Name")}
                    </label>
                    <input
                      type="text"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder={t(
                        "egMilkBreadApples",
                        "e.g. Milk, Bread, Apples...",
                      )}
                      autoFocus
                      style={inputStyle}
                      onFocus={(e) =>
                        (e.currentTarget.style.borderColor = P.teal)
                      }
                      onBlur={(e) =>
                        (e.currentTarget.style.borderColor = P.border)
                      }
                    />
                  </div>
                ) : (
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: P.muted,
                        marginBottom: 6,
                      }}
                    >
                      {t("barcodeEan", "Barcode (EAN)")}
                    </label>
                    <input
                      type="text"
                      value={manualEan}
                      onChange={(e) =>
                        setManualEan(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder={t("eg4006040055136", "e.g. 4006040055136")}
                      maxLength={14}
                      autoFocus
                      style={{ ...inputStyle, fontFamily: "monospace" }}
                      onFocus={(e) =>
                        (e.currentTarget.style.borderColor = P.teal)
                      }
                      onBlur={(e) =>
                        (e.currentTarget.style.borderColor = P.border)
                      }
                    />
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: 11,
                        color: P.subtle,
                        textAlign: "center",
                      }}
                    >
                      {t("length14Digits", "{{length}} / 14 digits", {
                        length: manualEan.length,
                      })}
                    </p>
                  </div>
                )}

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      color: P.muted,
                      marginBottom: 8,
                    }}
                  >
                    {t("quantity", "Quantity")}
                  </label>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      justifyContent: "center",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(-1)}
                      style={qtyBtnStyle(false)}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      value={manualQuantity}
                      onChange={(e) =>
                        setManualQuantity(
                          Math.max(1, parseInt(e.target.value) || 1),
                        )
                      }
                      min="1"
                      style={{
                        width: 80,
                        padding: "10px 8px",
                        backgroundColor: P.bg,
                        border: `2px solid ${P.tealB}`,
                        borderRadius: 10,
                        color: P.text,
                        fontSize: 26,
                        fontWeight: 700,
                        textAlign: "center",
                        outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(1)}
                      style={qtyBtnStyle(true)}
                    >
                      +
                    </button>
                  </div>
                </div>

                {error && (
                  <div
                    style={{
                      padding: "8px 12px",
                      backgroundColor: P.redD,
                      border: `1px solid ${P.redB}`,
                      borderRadius: 10,
                      fontSize: 13,
                      color: "#f87171",
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    (inputMode === "ean" &&
                      (!manualEan || manualEan.length < 8)) ||
                    (inputMode === "name" && !manualName.trim()) ||
                    showSuccess
                  }
                  style={{
                    ...submitBtnStyle,
                    opacity:
                      (inputMode === "ean" &&
                        (!manualEan || manualEan.length < 8)) ||
                      (inputMode === "name" && !manualName.trim()) ||
                      showSuccess
                        ? 0.4
                        : 1,
                    cursor:
                      (inputMode === "ean" &&
                        (!manualEan || manualEan.length < 8)) ||
                      (inputMode === "name" && !manualName.trim()) ||
                      showSuccess
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {t("addTo", "Add to")}{" "}
                  {isWishList ? "Wish List" : "Grocery List"}
                </button>
              </form>

              {verbose && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "7px 10px",
                    backgroundColor: P.bg,
                    borderRadius: 8,
                    border: `1px solid ${P.tealB}`,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      color: P.teal,
                      fontFamily: "monospace",
                    }}
                  >
                    {t(
                      "modeInputmodeQuantityManualquantity",
                      "Mode: {{inputMode}} | Quantity: {{manualQuantity}}",
                      { inputMode, manualQuantity },
                    )}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Quantity modal ── */}
      <QuantityRequiredModal
        open={pendingQuantity !== null}
        itemName={pendingQuantity?.itemName ?? "this item"}
        quantityValue={qtyAmount}
        unitValue={qtyUnit}
        units={QUANTITY_UNITS}
        submitting={qtySaving}
        onQuantityChange={setQtyAmount}
        onUnitChange={setQtyUnit}
        onConfirm={() => void saveWithQuantity()}
        onClose={() => {
          if (!qtySaving) {
            setPendingQuantity(null);
          }
        }}
      />

      <BottomTabBar />
    </div>
  );
}
