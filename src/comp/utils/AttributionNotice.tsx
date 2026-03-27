import React, { useState } from "react";

const P = {
  bg: "#0d1117",
  surface: "#161b22",
  border: "#21262d",
  teal: "#0d9488",
  tealB: "#0d948850",
  tealD: "#0f2a28",
  text: "#e6edf3",
  muted: "#6e7681",
  subtle: "#4d5566",
} as const;

interface AttributionNoticeProps {
  compact?: boolean;
  floating?: boolean;
}

const AttributionNotice: React.FC<AttributionNoticeProps> = ({
  compact = false,
  floating = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (floating) {
    return (
      <div
        style={{
          position: "fixed",
          bottom: "1rem",
          right: "1rem",
          zIndex: 1000,
        }}
      >
        {/* Collapsed Button */}
        {!isExpanded && (
          <button
            onClick={() => setIsExpanded(true)}
            style={{
              all: "unset",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "1em",
              height: "1em",
              borderRadius: 8,
              backgroundColor: P.surface,
              border: `1px solid ${P.border}`,
              color: "#8b949e",
              cursor: "pointer",
              fontSize: 18,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = P.tealB;
              e.currentTarget.style.color = "#5eead4";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = P.border;
              e.currentTarget.style.color = "#8b949e";
            }}
            title="Data Attribution"
          >
            ⓘ
          </button>
        )}

        {/* Expanded Panel */}
        {isExpanded && (
          <div
            style={{
              backgroundColor: P.surface,
              border: `1px solid ${P.border}`,
              borderRadius: 10,
              padding: "0.9rem 1rem",
              maxWidth: 260,
              fontSize: "0.78rem",
              lineHeight: 1.5,
              boxShadow: "0 8px 24px #00000060",
              animation: "slideIn 0.15s ease-out",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.8rem",
                  color: P.muted,
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                }}
              >
                Data Attribution
              </span>
              <button
                onClick={() => setIsExpanded(false)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  color: P.subtle,
                  fontSize: "1rem",
                  lineHeight: 1,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = P.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = P.subtle;
                }}
                title="Close"
              >
                ×
              </button>
            </div>
            <p style={{ margin: "0 0 0.4rem", color: P.muted }}>
              Uses data from{" "}
              <a
                href="https://world.openfoodfacts.org"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#5eead4", textDecoration: "none" }}
              >
                Open Food Facts
              </a>{" "}
              (database dump &amp; API).
            </p>
            <p style={{ margin: "0 0 0.4rem", color: P.subtle }}>
              Licensed under{" "}
              <a
                href="https://opendatacommons.org/licenses/odbl/1.0/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: P.muted, textDecoration: "underline" }}
              >
                ODbL
              </a>{" "}
              &amp;{" "}
              <a
                href="https://opendatacommons.org/licenses/dbcl/1.0/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: P.muted, textDecoration: "underline" }}
              >
                DbCL
              </a>
              .
            </p>
            <a
              href="https://world.openfoodfacts.org/terms-of-use"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: P.subtle,
                textDecoration: "underline",
                fontSize: "0.74rem",
              }}
            >
              Terms of Use →
            </a>
          </div>
        )}

        <style>{`
          @keyframes slideIn {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0);   }
          }
        `}</style>
      </div>
    );
  }

  if (compact) {
    return (
      <div style={{ margin: "1px", marginLeft: "3px" }}>
        {/* Collapsed Button */}
        {!isExpanded && (
          <button
            onClick={() => setIsExpanded(true)}
            style={{
              all: "unset",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "1.5em",
              height: "1.5em",
              borderRadius: 8,
              backgroundColor: P.surface,
              border: `1px solid ${P.border}`,
              color: P.muted,
              cursor: "pointer",
              fontSize: 12,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = P.tealB;
              e.currentTarget.style.color = "#5eead4";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = P.border;
              e.currentTarget.style.color = P.muted;
            }}
            title="Data Attribution"
          >
            ⓘ
          </button>
        )}

        {/* Expanded Panel */}
        {isExpanded && (
          <div
            style={{
              backgroundColor: P.surface,
              border: `1px solid ${P.border}`,
              borderRadius: 10,
              padding: "0.9rem 1rem",
              maxWidth: 260,
              fontSize: "0.78rem",
              lineHeight: 1.5,
              boxShadow: "0 8px 24px #00000060",
              animation: "slideIn 0.15s ease-out",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.8rem",
                  color: P.muted,
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                }}
              >
                Data Attribution
              </span>
              <button
                onClick={() => setIsExpanded(false)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  color: P.subtle,
                  fontSize: "1rem",
                  lineHeight: 1,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = P.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = P.subtle;
                }}
                title="Close"
              >
                ×
              </button>
            </div>
            <p style={{ margin: "0 0 0.4rem", color: P.muted }}>
              Uses data from{" "}
              <a
                href="https://world.openfoodfacts.org"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#5eead4", textDecoration: "none" }}
              >
                Open Food Facts
              </a>{" "}
              (database dump &amp; API).
            </p>
            <p style={{ margin: "0 0 0.4rem", color: P.subtle }}>
              Licensed under{" "}
              <a
                href="https://opendatacommons.org/licenses/odbl/1.0/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: P.muted, textDecoration: "underline" }}
              >
                ODbL
              </a>{" "}
              &amp;{" "}
              <a
                href="https://opendatacommons.org/licenses/dbcl/1.0/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: P.muted, textDecoration: "underline" }}
              >
                DbCL
              </a>
              .
            </p>
            <a
              href="https://world.openfoodfacts.org/terms-of-use"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: P.subtle,
                textDecoration: "underline",
                fontSize: "0.74rem",
              }}
            >
              Terms of Use →
            </a>
          </div>
        )}

        <style>{`
          @keyframes slideIn {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0);   }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: "#f9f9f9",
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "1.5rem",
        margin: "1rem 0",
        fontSize: "0.9rem",
        lineHeight: "1.6",
      }}
    >
      <h3 style={{ marginTop: 0, fontSize: "1.1rem", color: "#333" }}>
        Data Attribution
      </h3>
      <p style={{ margin: "0.5rem 0", color: "#555" }}>
        This application uses product data and services provided by{" "}
        <a
          href="https://world.openfoodfacts.org"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#ff8000", textDecoration: "underline" }}
        >
          Open Food Facts
        </a>
        , including:
      </p>
      <ul style={{ margin: "0.5rem 0 1rem 1.5rem", color: "#555" }}>
        <li>Product database dump</li>
        <li>Open Food Facts API</li>
      </ul>
      <p style={{ margin: "0.5rem 0", color: "#555" }}>
        The Open Food Facts database is available under the{" "}
        <a
          href="https://opendatacommons.org/licenses/odbl/1.0/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#ff8000", textDecoration: "underline" }}
        >
          Open Database License (ODbL)
        </a>
        , and individual contents are available under the{" "}
        <a
          href="https://opendatacommons.org/licenses/dbcl/1.0/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#ff8000", textDecoration: "underline" }}
        >
          Database Contents License (DbCL)
        </a>
        .
      </p>
      <p style={{ margin: "0.5rem 0 0", color: "#555" }}>
        For complete terms of use and licensing information, please refer to{" "}
        <a
          href="https://world.openfoodfacts.org/terms-of-use"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#ff8000", textDecoration: "underline" }}
        >
          Open Food Facts Terms of Use
        </a>
        .
      </p>
    </div>
  );
};

export default AttributionNotice;
