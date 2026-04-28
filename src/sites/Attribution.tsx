import { memo } from "react";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import { useTranslation } from "react-i18next";

function AttributionPage() {
  const { t } = useTranslation();
  const username = localStorage.getItem("username") ?? "L";

  const sources = [
    {
      name: t("openstreetmap", "OpenStreetMap"),
      url: "https://www.openstreetmap.org/copyright",
      description: t(
        "mapAndSupermarketLocationDataIsDerivedFromOpenstreetmapACollaborativeProjectToCreateAFreeEditableMapOfTheWorld",
        "Map and supermarket location data is derived from OpenStreetMap, a collaborative project to create a free editable map of the world.",
      ),
      license: t(
        "openDatabaseLicenseOdbl10",
        "Open Database License (ODbL) 1.0",
      ),
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      note: t("openstreetmapContributors", "© OpenStreetMap contributors"),
    },
    {
      name: t("photon", "Photon"),
      url: "https://photon.komoot.io",
      description: t(
        "geocodingAddressCoordinatesIsPoweredByPhotonAnOpensourceGeocoderBuiltOnOpenstreetmapDataOperatedByKomoot",
        "Geocoding (address → coordinates) is powered by Photon, an open-source geocoder built on OpenStreetMap data, operated by Komoot.",
      ),
      license: t(
        "openDatabaseLicenseOdbl10",
        "Open Database License (ODbL) 1.0",
      ),
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      note: t("geocodingByPhotonKomoot", "Geocoding by Photon / Komoot"),
    },
    {
      name: t("openFoodFacts", "Open Food Facts"),
      url: "https://world.openfoodfacts.org",
      description: t(
        "productInformationEanBarcodesNutritionalDataAndProductImagesAreSourcedFromOpenFoodFactsAFreeAndOpenDatabaseOfFoodProducts",
        "Product information, EAN barcodes, nutritional data, and product images are sourced from Open Food Facts, a free and open database of food products.",
      ),
      license: t(
        "openDatabaseLicenseOdbl10",
        "Open Database License (ODbL) 1.0",
      ),
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      note: t(
        "productDataFromOpenFoodFacts",
        "Product data from Open Food Facts",
      ),
    },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--bg)",
        color: "var(--text-main)",
        fontFamily: "var(--font-body)",
        paddingBottom: 90,
      }}
    >
      <AppHeader username={username} />

      <div style={{ padding: "0 16px", maxWidth: 640, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "var(--text-main)",
              margin: "0 0 6px",
            }}
          >
            {t("attributions", "Attributions")}
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            {t(
              "thisAppIsBuiltOnOpenDataWereGratefulToTheCommunitiesThatMakeTheseResourcesFreelyAvailable",
              "This app is built on open data. We're grateful to the communities\n            that make these resources freely available.",
            )}
          </p>
        </div>

        {/* Source cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sources.map((src) => (
            <div
              key={src.name}
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              {/* Teal accent bar */}
              <div
                style={{
                  height: 3,
                  background:
                    "linear-gradient(90deg, var(--accent), transparent)",
                }}
              />

              <div style={{ padding: "16px 18px" }}>
                {/* Name + link */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--text-main)",
                    }}
                  >
                    {src.name}
                  </span>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11,
                      color: "var(--accent-text)",
                      textDecoration: "none",
                      border: "1px solid var(--accent-border)",
                      borderRadius: 6,
                      padding: "3px 9px",
                      flexShrink: 0,
                      fontWeight: 500,
                    }}
                  >
                    {t("visit", "Visit ↗")}
                  </a>
                </div>

                {/* Description */}
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    margin: "0 0 12px",
                    lineHeight: 1.6,
                  }}
                >
                  {src.description}
                </p>

                {/* License row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderTop: "1px solid var(--border)",
                    paddingTop: 10,
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {src.note}
                  </span>
                  <a
                    href={src.licenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      textDecoration: "none",
                      fontFamily: "monospace",
                      flexShrink: 0,
                    }}
                  >
                    {src.license}
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            marginTop: 28,
            lineHeight: 1.6,
            textAlign: "center",
          }}
        >
          {t(
            "allThirdpartyDataIsUsedInAccordanceWithTheirRespectiveLicenses",
            "All third-party data is used in accordance with their respective\n          licenses.",
          )}{" "}
          <a
            href="https://opendatacommons.org/licenses/odbl/1-0/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--text-muted)", textDecoration: "underline" }}
          >
            {t("odbl10", "ODbL 1.0")}
          </a>
        </p>
      </div>

      <BottomTabBar />
    </div>
  );
}

export default memo(AttributionPage);
