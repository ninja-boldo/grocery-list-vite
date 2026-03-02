import { memo, useCallback, useState } from "react";
import Map, { Marker } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../styles/geo.css";

export interface Position {
  lat: number;
  lon: number;
  text?: string;
  valid?: boolean;
}

interface Props {
  zoom: number;
  centerPos?: Position;
  markedPositions: Position[];
  heightNum?: number;
  widthNum?: number;
}

const tileStyle = () => ({
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256 } },
  layers: [{ id: "osm", type: "raster", source: "osm", minzoom: 0, maxzoom: 20,
    paint: { "raster-saturation": -0.55, "raster-brightness-max": 0.65, "raster-contrast": 0.1 },
  }],
});

const mapsUrl = ({ lat, lon }: Position) =>
  /iPhone|iPad|MacIntel/.test(navigator.platform)
    ? `maps://maps.google.com/maps?daddr=${lat},${lon}&ll=`
    : `https://maps.google.com/maps?daddr=${lat},${lon}&ll=`;

const Pin = ({ active }: { active?: boolean }) => (
  <div className={`geo-pin${active ? " geo-pin--active" : ""}`} />
);

const BottomSheet = ({ pos, onClose }: { pos: Position; onClose: () => void }) => (
  <>
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 10 }} />
    <div className="geo-sheet">
      <div className="geo-sheet__handle" />
      <p className="geo-sheet__title">{pos.text}</p>
      <div className="geo-sheet__actions">
        <a href={mapsUrl(pos)} target="_blank" rel="noopener noreferrer" className="geo-sheet__btn geo-sheet__btn--primary">
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Directions
        </a>
        <button onClick={onClose} className="geo-sheet__btn geo-sheet__btn--ghost">Close</button>
      </div>
    </div>
  </>
);

const MapComponent = ({ zoom, centerPos, markedPositions, heightNum, widthNum }: Props) => {
  const [activePopup, setActivePopup] = useState<Position | null>(null);
  const handleMarkerClick = useCallback((pos: Position) => setActivePopup(p => p === pos ? null : pos), []);

  if (!centerPos?.valid) return null;

  return (
    <div className="geo-map" style={{ height: heightNum ? `${heightNum}px` : "100dvh", maxWidth: widthNum ? `${widthNum}px` : undefined }}>
      <Map
        initialViewState={{ longitude: centerPos.lon, latitude: centerPos.lat, zoom }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={tileStyle() as any}
        scrollZoom={true}
        touchPitch={true}
      >
        {/* <NavigationControl position="bottom-right" showCompass={false} /> */}
        {markedPositions.map((pos, i) => (
          <Marker key={i} longitude={pos.lon} latitude={pos.lat} anchor="bottom" onClick={() => handleMarkerClick(pos)}>
            <Pin active={activePopup === pos} />
          </Marker>
        ))}
      </Map>

      {activePopup && <BottomSheet pos={activePopup} onClose={() => setActivePopup(null)} />}

      <div className="geo-badge">{markedPositions.length} location{markedPositions.length !== 1 ? "s" : ""}</div>
    </div>
  );
};

export default memo(MapComponent);