import BottomTabBar from "@/comp/other/BottomTabBar";
import Sidebar from "@/comp/other/Sidebar";
import { useState } from "react";

const sources = [
  {
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    logo: null,
    description:
      "Map and supermarket location data is derived from OpenStreetMap, a collaborative project to create a free editable map of the world.",
    license: "Open Database License (ODbL) 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    note: "© OpenStreetMap contributors",
  },
  {
    name: "Photon",
    url: "https://photon.komoot.io",
    logo: null,
    description:
      "Geocoding (address → coordinates) is powered by Photon, an open-source geocoder built on OpenStreetMap data, operated by Komoot.",
    license: "Open Database License (ODbL) 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    note: "Geocoding by Photon / Komoot",
  },
  {
    name: "Open Food Facts",
    url: "https://world.openfoodfacts.org",
    logo: null,
    description:
      "Product information, EAN barcodes, nutritional data, and product images are sourced from Open Food Facts, a free and open database of food products.",
    license: "Open Database License (ODbL) 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    note: "Product data from Open Food Facts",
  },
];

export default function AttributionPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0d1117",
        color: "#e6edf3",
        fontFamily: "system-ui, sans-serif",
        padding: "48px 24px",
      }}
    >
      {isSidebarOpen && (
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
      )}
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "#e6edf3",
              margin: "0 0 8px",
            }}
          >
            Attributions
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#8b949e",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            This app is built on open data. We're grateful to the communities
            that make these resources freely available.
          </p>
        </div>

        {/* Source cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sources.map((src) => (
            <div
              key={src.name}
              style={{
                backgroundColor: "#161b22",
                border: "1px solid #21262d",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {/* Teal accent bar */}
              <div
                style={{
                  height: 3,
                  backgroundColor: "#0d9488",
                  borderRadius: "12px 12px 0 0",
                }}
              />

              <div style={{ padding: "18px 20px" }}>
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
                    style={{ fontSize: 15, fontWeight: 600, color: "#e6edf3" }}
                  >
                    {src.name}
                  </span>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 12,
                      color: "#2dd4bf",
                      textDecoration: "none",
                      border: "1px solid rgba(13,148,136,0.35)",
                      borderRadius: 6,
                      padding: "2px 9px",
                      flexShrink: 0,
                      transition: "background 0.15s",
                    }}
                  >
                    Visit ↗
                  </a>
                </div>

                {/* Description */}
                <p
                  style={{
                    fontSize: 13,
                    color: "#8b949e",
                    margin: "0 0 14px",
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
                    borderTop: "1px solid #21262d",
                    paddingTop: 12,
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 11, color: "#4d5566" }}>
                    {src.note}
                  </span>
                  <a
                    href={src.licenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11,
                      color: "#6e7681",
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
          <BottomTabBar />
        </div>

        {/* Footer note */}
        <p
          style={{
            fontSize: 12,
            color: "#4d5566",
            marginTop: 32,
            lineHeight: 1.6,
            textAlign: "center",
          }}
        >
          All third-party data is used in accordance with their respective
          licenses.{" "}
          <a
            href="https://opendatacommons.org/licenses/odbl/1-0/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#6e7681", textDecoration: "underline" }}
          >
            ODbL 1.0
          </a>
        </p>
      </div>
    </div>
  );
}
