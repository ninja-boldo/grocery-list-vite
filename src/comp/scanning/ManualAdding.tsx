import { useState, useCallback } from "react";
import ErrorContainer from "../utils/ErrorContainer";
import { useLocation, useNavigate } from "react-router-dom";
import TopBar from "@/comp/other/TopBar";
import Sidebar from "@/comp/other/Sidebar";
import QuantityRequiredModal from "@/comp/utils/QuantityRequiredModal";
import { PageModes } from "@/lib/utils";
import { apiClient } from "@/lib/api/client";
import { isAddEanSuccess, needsQuantityDetails } from "@/lib/api/addEanFlow";
import type { AddEanRequest, QuantityInfo } from "@/lib/api/openapi";

const P = {
  bg: "#18181b",
  surface: "#161b22",
  border: "#21262d",
  teal: "#0d9488",
  tealD: "#0f2a28",
  tealB: "#0d948850",
  text: "#e6edf3",
  muted: "#6e7681",
  subtle: "#4d5566",
} as const;

type Stage = "input" | "loading" | "success";

const UNITS = ["Stück", "g", "kg", "ml", "L", "EL", "TL", "Prise", "Bund", "Scheiben", "Zehe", "Dose", "Paket"];

type PendingAddPayload = {
  ean: string | null;
  item_name: string;
  count: number;
  wish_list: string;
};

const ManualAdd = () => {
  const navhook = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const isWishList = queryParams.get("wishlist") === "true";

  const [itemName, setItemName] = useState("");
  const [ean, setEan] = useState("");
  const [count, setCount] = useState("1");

  const [errorMessage, setErrorMessage] = useState("");
  const [showErrorBox, setShowErrorBox] = useState(false);
  const [stage, setStage] = useState<Stage>("input");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quantitySubmitting, setQuantitySubmitting] = useState(false);

  const [quantityInput, setQuantityInput] = useState("");
  const [unitInput, setUnitInput] = useState("Stück");
  const [pendingPayload, setPendingPayload] = useState<PendingAddPayload | null>(null);

  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    setShowErrorBox(true);
    setTimeout(() => setShowErrorBox(false), 2500);
  }, []);

  const submitWithQuantity = useCallback(
    async (quantity: QuantityInfo) => {
      if (!pendingPayload) return;
      setQuantitySubmitting(true);
      try {
        const response = await apiClient.addEanToList(
          {
            ean: pendingPayload.ean,
            item_name: pendingPayload.item_name,
            count: pendingPayload.count,
            wish_list: pendingPayload.wish_list,
            quantity_data: quantity,
          },
          { retries: 2, retryDelayMs: 250 },
        );

        if (needsQuantityDetails(response)) {
          showError("The server still needs a valid quantity and unit.");
          return;
        }

        if (!isAddEanSuccess(response)) {
          const message =
            typeof response.detail === "string" && response.detail.trim()
              ? response.detail
              : "Failed to add item. Please try again.";
          showError(message);
          return;
        }

        setPendingPayload(null);
        setStage("success");
        setTimeout(() => navhook("/"), 600);
      } catch (err) {
        console.error("Failed to add item:", err);
        showError("Failed to add item. Please try again.");
      } finally {
        setQuantitySubmitting(false);
      }
    },
    [pendingPayload, navhook, showError],
  );

  const handleQuantitySubmit = useCallback(() => {
    const qty = parseFloat(quantityInput);
    if (isNaN(qty) || qty <= 0) {
      showError("Please enter a valid quantity.");
      return;
    }
    const quantity: QuantityInfo = {
      product_quantity: qty,
      product_quantity_unit: unitInput,
    };
    void submitWithQuantity(quantity);
  }, [quantityInput, unitInput, submitWithQuantity, showError]);

  const sendRes = async () => {
    if (!itemName.trim()) {
      showError("Please enter an item name.");
      return;
    }
    const parsedCount = parseInt(count, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < 1) {
      showError("Count must be a positive number.");
      return;
    }

    setStage("loading");
    const payload: AddEanRequest = {
      ean: ean.trim() || null,
      item_name: itemName.trim(),
      count: parsedCount,
      wish_list: String(isWishList),
    };

    try {
      const response = await apiClient.addEanToList(payload, {
        retries: 2,
        retryDelayMs: 250,
      });

      if (needsQuantityDetails(response)) {
        setPendingPayload({
          ean: payload.ean ?? null,
          item_name: payload.item_name ?? "",
          count: payload.count ?? 1,
          wish_list: payload.wish_list ?? "false",
        });
        setQuantityInput("1");
        setUnitInput("Stück");
        setStage("input");
        return;
      }

      if (!isAddEanSuccess(response)) {
        const message =
          typeof response.detail === "string" && response.detail.trim()
            ? response.detail
            : "Failed to add item. Please try again.";
        showError(message);
        setStage("input");
      } else {
        setStage("success");
        setTimeout(() => navhook("/"), 600);
      }
    } catch (err) {
      console.error("Failed to add item:", err);
      showError("Failed to add item. Please try again.");
      setStage("input");
    }
  };

  const isLoading = stage === "loading";
  const showSuccess = stage === "success";

  return (
    <div
      className="h-screen"
      style={{
        background:
          "radial-gradient(circle at 12% 14%, rgba(212, 165, 116, 0.16), transparent 24%), radial-gradient(circle at 88% 18%, rgba(124, 170, 124, 0.2), transparent 26%), linear-gradient(180deg, #0f1416 0%, #101a1a 100%)",
      }}
    >
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <TopBar
        sidebarOpen={sidebarOpen}
        onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
        subgroups={[]}
        onFilter={null}
        onReset={() => null}
        onScanIncrease={() => null}
        onScanDecrease={() => null}
        items={[]}
        setItems={() => null}
        mode={PageModes.GeoPage}
      />

      <div className="flex-1 p-3 sm:p-4 md:p-6">
        <div className="max-w-4xl mx-auto">
          {showErrorBox && <ErrorContainer text={errorMessage} />}

          <div
            style={{
              background:
                "linear-gradient(160deg, rgba(16, 27, 34, 0.92) 0%, rgba(22, 33, 31, 0.94) 100%)",
              border: `1px solid ${showSuccess ? "rgba(124,170,124,0.8)" : "rgba(124,170,124,0.24)"}`,
              borderRadius: 24,
              padding: "26px 22px",
              marginTop: 16,
              boxShadow: "0 20px 48px rgba(0, 0, 0, 0.45)",
              transition: "border-color 0.2s",
            }}
          >
            <p
              style={{
                margin: "0 0 20px",
                fontSize: 17,
                fontWeight: 700,
                color: showSuccess ? "#c9f4d4" : P.text,
                borderBottom: "1px solid rgba(124,170,124,0.22)",
                paddingBottom: 14,
                transition: "color 0.2s",
              }}
            >
              {showSuccess
                ? "✓ Added successfully!"
                : isWishList
                  ? "Add to Wish List"
                  : "Add Item Manually"}
            </p>

            <>
              <p style={{ fontSize: 13, color: P.muted, margin: "0 0 14px" }}>
                {isWishList
                  ? "Save a new wish-list entry with optional barcode and count."
                  : "Save a new inventory item with optional barcode and count."}
              </p>

              <input
                type="text"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && stage === "input") void sendRes();
                }}
                placeholder="Item name *"
                disabled={isLoading || showSuccess}
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 10,
                  padding: "10px 12px",
                  backgroundColor: "rgba(10,16,20,0.9)",
                  border: "1px solid rgba(124,170,124,0.28)",
                  borderRadius: 12,
                  color: P.text,
                  fontSize: 14,
                  outline: "none",
                  transition: "border-color 0.15s",
                  opacity: isLoading || showSuccess ? 0.5 : 1,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = P.teal)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(124,170,124,0.28)")}
              />

              <input
                type="text"
                value={ean}
                onChange={(e) => setEan(e.target.value.replace(/\D/g, ""))}
                placeholder="EAN barcode (optional)"
                disabled={isLoading || showSuccess}
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 10,
                  padding: "10px 12px",
                  backgroundColor: "rgba(10,16,20,0.9)",
                  border: "1px solid rgba(124,170,124,0.28)",
                  borderRadius: 12,
                  color: P.text,
                  fontSize: 14,
                  fontFamily: "monospace",
                  outline: "none",
                  transition: "border-color 0.15s",
                  opacity: isLoading || showSuccess ? 0.5 : 1,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = P.teal)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(124,170,124,0.28)")}
              />

              <input
                type="number"
                value={count}
                min={1}
                onChange={(e) => setCount(e.target.value)}
                placeholder="Count (default = 1)"
                disabled={isLoading || showSuccess}
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 10,
                  padding: "10px 12px",
                  backgroundColor: "rgba(10,16,20,0.9)",
                  border: "1px solid rgba(124,170,124,0.28)",
                  borderRadius: 12,
                  color: P.text,
                  fontSize: 14,
                  outline: "none",
                  transition: "border-color 0.15s",
                  opacity: isLoading || showSuccess ? 0.5 : 1,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = P.teal)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(124,170,124,0.28)")}
              />

              <button
                onClick={() => void sendRes()}
                disabled={isLoading || showSuccess || !itemName.trim()}
                style={{
                  all: "unset",
                  boxSizing: "border-box",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  marginTop: 10,
                  padding: "10px 20px",
                  background:
                    "linear-gradient(135deg, rgba(124,170,124,0.92) 0%, rgba(86,130,103,0.95) 100%)",
                  border: "1px solid rgba(124,170,124,0.5)",
                  borderRadius: 12,
                  color: "#101d13",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor:
                    isLoading || showSuccess || !itemName.trim()
                      ? "not-allowed"
                      : "pointer",
                  opacity: isLoading || !itemName.trim() ? 0.5 : 1,
                  transition: "all 0.15s",
                }}
              >
                {isLoading ? (
                  <>
                    <svg
                      style={{
                        width: 13,
                        height: 13,
                        animation: "spin 1s linear infinite",
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
                    Adding...
                  </>
                ) : (
                  "Submit"
                )}
              </button>
            </>
          </div>
        </div>
      </div>

      <QuantityRequiredModal
        open={pendingPayload !== null}
        itemName={pendingPayload?.item_name || itemName || "this item"}
        quantityValue={quantityInput}
        unitValue={unitInput}
        units={UNITS}
        submitting={quantitySubmitting}
        onQuantityChange={setQuantityInput}
        onUnitChange={setUnitInput}
        onConfirm={handleQuantitySubmit}
        onClose={() => {
          if (!quantitySubmitting) {
            setPendingPayload(null);
          }
        }}
      />

      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`,
        }}
      />
    </div>
  );
};

export default ManualAdd;