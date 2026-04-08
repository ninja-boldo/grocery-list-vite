import { useState, useRef, useEffect, memo } from "react";
import type { Item } from "../../App.tsx";
import {
  PageModes,
  transformItems,
  type ApiResponse,
} from "../../lib/utils.ts";
import { authApiCall } from "../../lib/authApi";
// ── Palette (mirrors Container) ────────────────────────────────────────────
const P = {
  bg: "#0d1117",
  surface: "#161b22",
  border: "#21262d",
  teal: "#0d9488",
  tealD: "#0f2a28",
  tealB: "#0d948850",
  text: "#e6edf3",
  muted: "#6e7681",
  subtle: "#4d5566",
} as const;

// ── MergedDropdown ─────────────────────────────────────────────
interface DropdownProps {
  classNames: string[];
  sortOrder: string[];
  selectedClass: string | null;
  onClickElement: (
    classFilter: string | null,
    sortOrder: string | undefined,
  ) => void;
  onClickReset: () => void;
}

const MergedDropdown = memo(
  ({
    classNames,
    sortOrder,
    selectedClass,
    onClickElement,
    onClickReset,
  }: DropdownProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<"classes" | "sortOrder">(
      "classes",
    );
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const h = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node))
          setIsOpen(false);
      };
      document.addEventListener("mousedown", h);
      return () => document.removeEventListener("mousedown", h);
    }, []);

    const currentElements = activeTab === "classes" ? classNames : sortOrder;

    const handleElement = (el: string) => {
      if (activeTab === "classes") {
        onClickElement(el, undefined);
      } else {
        onClickElement(null, el);
      }
      setIsOpen(false);
    };

    const buttonLabel = selectedClass ?? "filter";

    return (
      <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
        {/* Trigger row */}
        <div style={{ display: "flex", gap: 0 }}>
          {/* Label / reset button */}
          <button
            onClick={() => {
              onClickReset();
              setIsOpen(false);
            }}
            style={{
              all: "unset",
              boxSizing: "border-box",
              display: "inline-flex",
              alignItems: "center",
              height: 32,
              padding: "0 10px",
              backgroundColor: P.surface,
              color: isOpen ? "#5eead4" : P.muted,
              border: `1px solid ${isOpen ? P.tealB : P.border}`,
              borderRight: "none",
              borderTopLeftRadius: 10,
              borderBottomLeftRadius: 10,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              transition: "all 0.15s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = P.text;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = isOpen
                ? "#5eead4"
                : P.muted;
            }}
          >
            {buttonLabel}
          </button>
          {/* Chevron toggle */}
          <button
            onClick={() => setIsOpen((v) => !v)}
            style={{
              all: "unset",
              boxSizing: "border-box",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 32,
              backgroundColor: isOpen ? P.tealD : P.surface,
              color: isOpen ? "#5eead4" : P.muted,
              border: `1px solid ${isOpen ? P.tealB : P.border}`,
              borderTopRightRadius: 10,
              borderBottomRightRadius: 10,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{
                transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>

        {/* Dropdown panel */}
        {isOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              backgroundColor: P.surface,
              border: `1px solid ${P.tealB}`,
              borderRadius: 12,
              boxShadow: `0 0 0 1px ${P.teal}22, 0 12px 32px #00000060`,
              zIndex: 1000,
              minWidth: 180,
              overflow: "hidden",
            }}
          >
            {/* Tabs */}
            <div
              style={{ display: "flex", borderBottom: `1px solid ${P.border}` }}
            >
              {(["classes", "sortOrder"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    all: "unset",
                    boxSizing: "border-box",
                    flex: 1,
                    padding: "7px 0",
                    textAlign: "center",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    color: activeTab === tab ? "#5eead4" : P.subtle,
                    backgroundColor:
                      activeTab === tab ? P.tealD : "transparent",
                    borderBottom:
                      activeTab === tab
                        ? `2px solid ${P.teal}`
                        : "2px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  {tab === "classes" ? "Classes" : "Sort"}
                </button>
              ))}
            </div>
            {/* Items */}
            <div
              style={{
                maxHeight: 260,
                overflowY: "auto",
                scrollbarWidth: "thin",
                scrollbarColor: `${P.border} transparent`,
              }}
            >
              {currentElements.map((el, i) => (
                <button
                  key={i}
                  onClick={() => handleElement(el)}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{
                    all: "unset",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 12px",
                    backgroundColor: hoveredIdx === i ? P.tealD : "transparent",
                    color: hoveredIdx === i ? "#5eead4" : P.text,
                    cursor: "pointer",
                    fontSize: 13,
                    borderBottom:
                      i < currentElements.length - 1
                        ? `1px solid ${P.border}`
                        : "none",
                    transition: "all 0.12s",
                  }}
                >
                  {hoveredIdx === i && (
                    <div
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 999,
                        backgroundColor: P.teal,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {el}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);

interface SearchProps {
  placeholder: string;
  itemsToRender: Item[];
  setItemsToRender: (items: Item[]) => void;
  currentSortOrder: string;
  pageMode: PageModes;
  onSearchStateChange?: (isActive: boolean) => void;
}

const SearchBar = memo(
  ({
    placeholder,
    itemsToRender,
    setItemsToRender,
    currentSortOrder,
    pageMode,
    onSearchStateChange,
  }: SearchProps) => {
    const [expanded, setExpanded] = useState(false);
    const [query, setQuery] = useState("");
    const queryRef = useRef("");
    const allRef = useRef<Item[]>(itemsToRender);
    const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const latestRequestIdRef = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    const fetchSearch = async (query: string): Promise<Item[]> => {
      if (
        !(pageMode === PageModes.WishPage || pageMode === PageModes.HomePage)
      ) {
        console.error("the page mode " + pageMode + " isnt searchable");
      }
      const isWish = pageMode === PageModes.WishPage ? true : false;

      const params = new URLSearchParams({
        only_wish_list: isWish.toString(),
        sortOrder: currentSortOrder,
        searchQuery: query,
        userId: "1",
      });
      const parsedResp = await authApiCall<ApiResponse>(
        `/api/fetch_items?${params.toString()}`,
        undefined,
        { retries: 1 },
      );

      console.log(`fetch url: /api/fetch_items?${params.toString()}`);
      console.log("parsed resp:", parsedResp);

      if (!Array.isArray(parsedResp?.items)) {
        console.error("fetch_items returned unexpected payload", parsedResp);
        return [];
      }

      return transformItems(parsedResp as ApiResponse);
    };

    const runSearch = (q: string) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      const hasQuery = q.trim().length > 0;
      onSearchStateChange?.(hasQuery);

      const requestId = ++latestRequestIdRef.current;

      if (!hasQuery) {
        setItemsToRender(allRef.current);
        return;
      }

      debounceTimeoutRef.current = setTimeout(async () => {
        try {
          const searchedItems: Item[] = await fetchSearch(q);
          // Ignore late responses from older queries.
          if (requestId !== latestRequestIdRef.current) return;
          setItemsToRender(searchedItems);
        } catch (error) {
          console.error("search failed", error);
        }
      }, 500);
    };

    const close = () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      latestRequestIdRef.current += 1;
      onSearchStateChange?.(false);
      queryRef.current = "";
      setQuery("");
      setExpanded(false);
      setItemsToRender(allRef.current);
    };

    useEffect(() => {
      if (expanded) setTimeout(() => inputRef.current?.focus(), 50);
    }, [expanded]);

    useEffect(() => {
      if (!query.trim()) {
        allRef.current = itemsToRender;
      }
    }, [itemsToRender, query]);

    useEffect(() => {
      queryRef.current = query;
    }, [query]);

    useEffect(() => {
      return () => {
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
      };
    }, []);

    useEffect(() => {
      const h = (e: MouseEvent) => {
        if (
          expanded &&
          wrapRef.current &&
          !wrapRef.current.contains(e.target as Node) &&
          queryRef.current.trim().length === 0
        ) {
          if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
          }
          latestRequestIdRef.current += 1;
          onSearchStateChange?.(false);
          queryRef.current = "";
          setQuery("");
          setExpanded(false);
          setItemsToRender(allRef.current);
        }
      };
      document.addEventListener("mousedown", h);
      return () => document.removeEventListener("mousedown", h);
    }, [expanded, onSearchStateChange, setItemsToRender]);

    if (!expanded) {
      return (
        <button
          onClick={() => setExpanded(true)}
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
            borderRadius: 10,
            color: P.muted,
            cursor: "pointer",
            transition: "all 0.15s",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = P.tealB;
            (e.currentTarget as HTMLElement).style.color = "#5eead4";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = P.border;
            (e.currentTarget as HTMLElement).style.color = P.muted;
          }}
          aria-label="Search"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      );
    }

    return (
      <div
        ref={wrapRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 60,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          backgroundColor: P.bg,
          borderRadius: "inherit",
          border: `1px solid ${P.tealB}`,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={P.subtle}
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            const nextQuery = e.target.value;
            queryRef.current = nextQuery;
            setQuery(nextQuery);
            runSearch(nextQuery);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          placeholder={placeholder}
          style={{
            all: "unset",
            flex: 1,
            fontSize: 14,
            color: P.text,
            caretColor: P.teal,
          }}
        />
        {query && (
          <button
            onClick={() => {
              if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
              }
              latestRequestIdRef.current += 1;
              onSearchStateChange?.(false);
              queryRef.current = "";
              setQuery("");
              setItemsToRender(allRef.current);
              inputRef.current?.focus();
            }}
            style={{
              all: "unset",
              color: P.subtle,
              cursor: "pointer",
              lineHeight: 1,
              fontSize: 16,
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.color = P.text)
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.color = P.subtle)
            }
          >
            ×
          </button>
        )}
        <button
          onClick={close}
          style={{
            all: "unset",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: P.surface,
            border: `1px solid ${P.border}`,
            color: P.muted,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 500,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "#ef444430";
            (e.currentTarget as HTMLElement).style.color = "#f87171";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = P.border;
            (e.currentTarget as HTMLElement).style.color = P.muted;
          }}
          aria-label="Close search"
        >
          esc
        </button>
      </div>
    );
  },
);

// TopBar
interface TopBarProps {
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  classNames: string[];
  selectedClass: string | null;
  onFilter: (classFilter: string | null, sortOrder: string | undefined) => void;
  onReset: () => void;
  onScanIncrease: () => void;
  onScanDecrease: () => void;
  items: Item[];
  setItems: (items: Item[]) => void;
  currentSortOrder: string;
  mode: PageModes;
  onSearchStateChange?: (isActive: boolean) => void;
  /** When false, renders as a simple inline bar without sticky/floating treatment */
  floating?: boolean;
}

const TopBar = ({
  sidebarOpen,
  onSidebarToggle,
  classNames,
  selectedClass,
  onFilter,
  onReset,
  onScanIncrease,
  onScanDecrease,
  items,
  setItems,
  currentSortOrder,
  mode,
  onSearchStateChange,
  floating = true,
}: TopBarProps) => {
  const scanBtnStyle = (): React.CSSProperties => ({
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    border: `1px solid ${P.border}`,
    borderRadius: 10,
    cursor: "pointer",
    fontSize: 18,
    lineHeight: "1",
    fontWeight: 300,
    backgroundColor: P.surface,
    color: P.muted,
    transition: "all 0.15s",
  });

  if (!floating) {
    return (
      <div
        style={{
          width: "100%",
          display: "flex",
          padding: "4px 12px 8px",
          boxSizing: "border-box",
        }}
      >
        {/* position:relative here so SearchBar's inset:0 covers the full row.
            minHeight keeps the div from collapsing to 0 when SearchBar
            switches to position:absolute (which removes it from flow). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            position: "relative",
            minWidth: 0,
            minHeight: 36,
          }}
        >
          {/* Filter dropdown — only on HomePage */}
          {mode === PageModes.HomePage ? (
            <MergedDropdown
              classNames={classNames}
              selectedClass={selectedClass}
              sortOrder={["A-Z", "Z-A", "new-old", "old-new"]}
              onClickElement={onFilter}
              onClickReset={onReset}
            />
          ) : null}

          {/* Spacer pushes search icon to the right */}
          <div style={{ flex: 1 }} />

          {/* SearchBar — collapsed = 32×32 icon; expanded = position:absolute inset:0 */}
          <SearchBar
            placeholder="Search items…"
            itemsToRender={items}
            setItemsToRender={setItems}
            currentSortOrder={currentSortOrder}
            pageMode={mode}
            onSearchStateChange={onSearchStateChange}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        position: "sticky",
        top: 6,
        zIndex: 50,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          height: 52,
          backgroundColor: P.bg,
          border: `1px solid ${P.tealB}`,
          borderRadius: 18,
          boxShadow: `0 0 0 1px ${P.teal}18, 0 8px 32px #00000060`,
          position: "relative",
          minWidth: 0,
        }}
      >
        {/* Sidebar toggle */}
        <button
          onClick={onSidebarToggle}
          style={{
            all: "unset",
            boxSizing: "border-box",
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 9,
            backgroundColor: sidebarOpen ? P.tealD : P.surface,
            border: `1px solid ${sidebarOpen ? P.tealB : P.border}`,
            color: sidebarOpen ? "#5eead4" : P.muted,
            cursor: "pointer",
            transition: "all 0.15s",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = P.tealB;
            (e.currentTarget as HTMLElement).style.color = "#5eead4";
          }}
          onMouseLeave={(e) => {
            if (!sidebarOpen) {
              (e.currentTarget as HTMLElement).style.borderColor = P.border;
              (e.currentTarget as HTMLElement).style.color = P.muted;
            }
          }}
          aria-label="Toggle sidebar"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Thin separator */}
        <div
          style={{
            width: 1,
            height: 20,
            backgroundColor: P.border,
            flexShrink: 0,
          }}
        />

        {/* Filter dropdown */}
        {mode === PageModes.HomePage ? (
          <MergedDropdown
            classNames={classNames}
            selectedClass={selectedClass}
            sortOrder={["A-Z", "Z-A", "new-old", "old-new"]}
            onClickElement={onFilter}
            onClickReset={onReset}
          />
        ) : null}

        {mode === PageModes.HomePage ? (
          <div
            style={{
              width: 1,
              height: 20,
              backgroundColor: P.border,
              flexShrink: 0,
            }}
          />
        ) : null}
        {/* Thin separator */}
        {mode === PageModes.HomePage || mode == PageModes.WishPage ? (
          <>
            {/* Scan +/− pair — same visual language as Container buttons */}
            <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
              <button
                onClick={onScanDecrease}
                aria-label="Scan decrease"
                style={scanBtnStyle()}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLElement;
                  b.style.backgroundColor = "#1c2128";
                  b.style.borderColor = "#ef444430";
                  b.style.color = "#f87171";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLElement;
                  b.style.backgroundColor = P.surface;
                  b.style.borderColor = P.border;
                  b.style.color = P.muted;
                }}
              >
                −
              </button>
              <button
                onClick={onScanIncrease}
                aria-label="Scan increase"
                style={scanBtnStyle()}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLElement;
                  b.style.backgroundColor = "#1c2128";
                  b.style.borderColor = P.tealB;
                  b.style.color = "#5eead4";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLElement;
                  b.style.backgroundColor = P.surface;
                  b.style.borderColor = P.border;
                  b.style.color = P.muted;
                }}
              >
                +
              </button>
            </div>

            {/* Thin separator */}
            <div
              style={{
                width: 1,
                height: 20,
                backgroundColor: P.border,
                flexShrink: 0,
              }}
            />
          </>
        ) : null}
        {/* Search */}
        <SearchBar
          placeholder="Search items…"
          itemsToRender={items}
          setItemsToRender={setItems}
          currentSortOrder={currentSortOrder}
          pageMode={mode}
          onSearchStateChange={onSearchStateChange}
        />
      </header>
    </div>
  );
};

export default memo(TopBar);
