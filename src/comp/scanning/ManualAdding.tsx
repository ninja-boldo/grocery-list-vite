import { useState } from "react";
import ErrorContainer from "../utils/ErrorContainer";
import { useLocation, useNavigate } from "react-router-dom";
import TopBar from "@/comp/other/TopBar";
import Sidebar from "@/comp/other/Sidebar";
import { PageModes } from "@/lib/utils";

// ── Palette (mirrors main site) ────────────────────────────────────────────
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

const ManualAdd = () => {
  const navhook = useNavigate();

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const isWishList = queryParams.get("wishlist");

  const [inputValue1, setInputValue1] = useState("");
  const [inputValue2, setInputValue2] = useState("");
  const [inputValue3, setInputValue3] = useState("");
  const [inputValue4, setInputValue4] = useState("");

  const [itemName, setItemName] = useState<string | null>(null);
  const [ean, setEan] = useState<string | null>(null);
  const [count, setCount] = useState<string | null>(null);
  const [subgroups, setSubgroups] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [showErrorBox, setshowErrorBox] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const sendRes = () => {
    let currentCount: string = count ? count : "1";
    let currentItemName: string = "";
    let currentSubgroups: string = subgroups ? subgroups : "";
    //let currentEan = ean

    if (!itemName) {
      console.warn("no item name supplied");
      setErrorMessage("you havent supplied the necessary item name");
      setshowErrorBox(true);

      setTimeout(() => {
        setshowErrorBox(false);
      }, 2500);
    } else {
      currentItemName = itemName;
    }
    if (!ean) {
      console.warn("no ean supplied");
      setEan("none");
    }
    if (!subgroups) {
      console.warn("no subgroups supplied");
      setSubgroups("none");
      currentSubgroups = "none";
    }
    if (!count) {
      console.warn("no count supplied");
      setCount("1");
      currentCount = "1";
      setTimeout(() => {}, 50);
    }

    console.log(
      "ean: " +
        ean +
        " item name: " +
        itemName +
        " subgroups: " +
        subgroups +
        " count: " +
        currentCount,
    );
    console.log("'" + currentSubgroups + "'");

    if (
      currentItemName && currentCount && currentSubgroups && currentCount
        ? parseInt(currentCount) > 0
        : false
    ) {
      console.log(
        "now sending to this endpoint with this url: " +
          `/api/add_ean_to_list_manual/?item_name=${encodeURIComponent(currentItemName)}&subgroups=${currentSubgroups}&count=${encodeURIComponent(currentCount)}&is_wish_list=${isWishList}`,
      );

      fetch(
        `/api/add_ean_to_list_manual/?item_name=${encodeURIComponent(currentItemName)}&subgroups=${currentSubgroups}&count=${encodeURIComponent(currentCount)}&is_wish_list=${isWishList}`,
      );

      setTimeout(() => {
        navhook("/");
      }, 300);
    }
  };

  return (
    <div className="h-screen" style={{ backgroundColor: P.bg }}>
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

          {/* Form card */}
          <div
            style={{
              backgroundColor: P.surface,
              border: `1px solid ${P.border}`,
              borderRadius: 18,
              padding: "24px 20px",
              marginTop: 16,
              boxShadow: `0 8px 32px #00000060`,
            }}
          >
            {/* Title */}
            <p
              style={{
                margin: "0 0 20px",
                fontSize: 15,
                fontWeight: 600,
                color: P.text,
                borderBottom: `1px solid ${P.border}`,
                paddingBottom: 14,
              }}
            >
              {isWishList ? "Add to Wish List" : "Add Item Manually"}
            </p>

            {/* Inputs */}
            {[
              {
                value: inputValue1,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  setInputValue1(e.target.value);
                  setItemName(e.target.value);
                },
                placeholder: "Item name *",
              },
              {
                value: inputValue2,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  setInputValue2(e.target.value);
                  setEan(e.target.value);
                },
                placeholder: "EAN (optional)",
              },
              {
                value: inputValue3,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  setInputValue3(e.target.value);
                  setCount(e.target.value);
                },
                placeholder: "Count (default = 1)",
              },
              {
                value: inputValue4,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  setInputValue4(e.target.value);
                  console.log("inputValue4: " + inputValue4);
                  setSubgroups(e.target.value);
                },
                placeholder: "Subgroups (optional)",
              },
            ].map(({ value, onChange, placeholder }, idx) => (
              <input
                key={idx}
                type="text"
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 10,
                  padding: "9px 12px",
                  backgroundColor: P.bg,
                  border: `1px solid ${P.border}`,
                  borderRadius: 10,
                  color: P.text,
                  fontSize: 14,
                  outline: "none",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = P.teal)}
                onBlur={(e) => (e.currentTarget.style.borderColor = P.border)}
              />
            ))}

            {/* Submit button */}
            <button
              onClick={sendRes}
              style={{
                all: "unset",
                boxSizing: "border-box",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 8,
                padding: "9px 20px",
                backgroundColor: P.tealD,
                border: `1px solid ${P.tealB}`,
                borderRadius: 10,
                color: "#5eead4",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                const b = e.currentTarget as HTMLElement;
                b.style.backgroundColor = P.teal;
                b.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                const b = e.currentTarget as HTMLElement;
                b.style.backgroundColor = P.tealD;
                b.style.color = "#5eead4";
              }}
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManualAdd;
