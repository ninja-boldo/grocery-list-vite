import React, { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import i18next from "i18next";

const P = {
  bg: "#0d1117",
  surface: "#161b22",
  border: "#21262d",
  teal: "#0d9488",
  tealB: "#0d948850",
  tealD: "#0f2a28",
  text: i18next.t("e6edf3", "#e6edf3"),
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
  const { t } = useTranslation();
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
            title={t("dataAttribution", "Data Attribution")}
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
                {t("dataAttribution", "Data Attribution")}
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
                title={t("close", "Close")}
              >
                ×
              </button>
            </div>
            <p style={{ margin: "0 0 0.4rem", color: P.muted }}>
              {t("usesDataFrom", "Uses data from")}{" "}
              <a
                href="https://world.openfoodfacts.org"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#5eead4", textDecoration: "none" }}
              >
                {t("openFoodFacts", "Open Food Facts")}
              </a>{" "}
              {t("databaseDumpAmpApi", "(database dump &amp; API).")}
            </p>
            <p style={{ margin: "0 0 0.4rem", color: P.subtle }}>
              {t("licensedUnder", "Licensed under")}{" "}
              <a
                href="https://opendatacommons.org/licenses/odbl/1.0/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: P.muted, textDecoration: "underline" }}
              >
                {t("odbl", "ODbL")}
              </a>{" "}
              {t("amp", "&amp;")}{" "}
              <Trans i18nKey="aHrefhttpsopendatacommonsorglicensesdbcl10Target_blankRelnoopenerNoreferrerStyleColorPmutedTextdecorationUnderlineDbclA">
                <a
                  href="https://opendatacommons.org/licenses/dbcl/1.0/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: P.muted, textDecoration: "underline" }}
                >
                  DbCL
                </a>
                .
              </Trans>
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
              {t("termsOfUse", "Terms of Use →")}
            </a>
          </div>
        )}

        <style>
          {t(
            "keyframesSlideinFromOpacity0TransformTranslatey6pxToOpacity1TransformTranslatey0",
            "@keyframes slideIn {\n            from { opacity: 0; transform: translateY(6px); }\n            to   { opacity: 1; transform: translateY(0);   }\n          }",
          )}
        </style>
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
            title={t("dataAttribution", "Data Attribution")}
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
                {t("dataAttribution", "Data Attribution")}
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
                title={t("close", "Close")}
              >
                ×
              </button>
            </div>
            <p style={{ margin: "0 0 0.4rem", color: P.muted }}>
              {t("usesDataFrom", "Uses data from")}{" "}
              <a
                href="https://world.openfoodfacts.org"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#5eead4", textDecoration: "none" }}
              >
                {t("openFoodFacts", "Open Food Facts")}
              </a>{" "}
              {t("databaseDumpAmpApi", "(database dump &amp; API).")}
            </p>
            <p style={{ margin: "0 0 0.4rem", color: P.subtle }}>
              {t("licensedUnder", "Licensed under")}{" "}
              <a
                href="https://opendatacommons.org/licenses/odbl/1.0/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: P.muted, textDecoration: "underline" }}
              >
                {t("odbl", "ODbL")}
              </a>{" "}
              {t("amp", "&amp;")}{" "}
              <Trans i18nKey="aHrefhttpsopendatacommonsorglicensesdbcl10Target_blankRelnoopenerNoreferrerStyleColorPmutedTextdecorationUnderlineDbclA">
                <a
                  href="https://opendatacommons.org/licenses/dbcl/1.0/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: P.muted, textDecoration: "underline" }}
                >
                  DbCL
                </a>
                .
              </Trans>
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
              {t("termsOfUse", "Terms of Use →")}
            </a>
          </div>
        )}

        <style>
          {t(
            "keyframesSlideinFromOpacity0TransformTranslatey6pxToOpacity1TransformTranslatey0",
            "@keyframes slideIn {\n            from { opacity: 0; transform: translateY(6px); }\n            to   { opacity: 1; transform: translateY(0);   }\n          }",
          )}
        </style>
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
        {t("dataAttribution", "Data Attribution")}
      </h3>
      <p style={{ margin: "0.5rem 0", color: "#555" }}>
        {t(
          "thisApplicationUsesProductDataAndServicesProvidedBy",
          "This application uses product data and services provided by",
        )}{" "}
        <Trans i18nKey="aHrefhttpsworldopenfoodfactsorgTarget_blankRelnoopenerNoreferrerStyleColorFf8000TextdecorationUnderlineOpenFoodFactsAIncluding">
          <a
            href="https://world.openfoodfacts.org"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#ff8000", textDecoration: "underline" }}
          >
            Open Food Facts
          </a>
          , including:
        </Trans>
      </p>
      <ul style={{ margin: "0.5rem 0 1rem 1.5rem", color: "#555" }}>
        <li>{t("productDatabaseDump", "Product database dump")}</li>
        <li>{t("openFoodFactsApi", "Open Food Facts API")}</li>
      </ul>
      <p style={{ margin: "0.5rem 0", color: "#555" }}>
        {t(
          "theOpenFoodFactsDatabaseIsAvailableUnderThe",
          "The Open Food Facts database is available under the",
        )}{" "}
        <Trans i18nKey="aHrefhttpsopendatacommonsorglicensesodbl10Target_blankRelnoopenerNoreferrerStyleColorFf8000TextdecorationUnderlineOpenDatabaseLicenseOdblAAndIndividualContentsAreAvailableUnderThe">
          <a
            href="https://opendatacommons.org/licenses/odbl/1.0/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#ff8000", textDecoration: "underline" }}
          >
            Open Database License (ODbL)
          </a>
          , and individual contents are available under the
        </Trans>{" "}
        <Trans i18nKey="aHrefhttpsopendatacommonsorglicensesdbcl10Target_blankRelnoopenerNoreferrerStyleColorFf8000TextdecorationUnderlineDatabaseContentsLicenseDbclA">
          <a
            href="https://opendatacommons.org/licenses/dbcl/1.0/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#ff8000", textDecoration: "underline" }}
          >
            Database Contents License (DbCL)
          </a>
          .
        </Trans>
      </p>
      <p style={{ margin: "0.5rem 0 0", color: "#555" }}>
        {t(
          "forCompleteTermsOfUseAndLicensingInformationPleaseReferTo",
          "For complete terms of use and licensing information, please refer to",
        )}{" "}
        <Trans i18nKey="aHrefhttpsworldopenfoodfactsorgtermsofuseTarget_blankRelnoopenerNoreferrerStyleColorFf8000TextdecorationUnderlineOpenFoodFactsTermsOfUseA">
          <a
            href="https://world.openfoodfacts.org/terms-of-use"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#ff8000", textDecoration: "underline" }}
          >
            Open Food Facts Terms of Use
          </a>
          .
        </Trans>
      </p>
    </div>
  );
};

export default AttributionNotice;
