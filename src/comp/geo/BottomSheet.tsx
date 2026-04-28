import type { Position } from "./Map";
import i18next from "i18next";

const mapsUrl = ({ lat, lon }: Position) =>
  /iPhone|iPad|MacIntel/.test(navigator.platform)
    ? `maps://maps.google.com/maps?daddr=${lat},${lon}&ll=`
    : `https://maps.google.com/maps?daddr=${lat},${lon}&ll=`;

export const Pin = ({ active }: { active?: boolean }) => (
  <div className={`geo-pin${active ? " geo-pin--active" : ""}`} />
);

export const BottomSheet = ({
  pos,
  onClose,
  onSubmitCatalogue,
  onViewOffers,
}: {
  pos: Position;
  onClose: () => void;
  onSubmitCatalogue: (pos: Position) => void;
  onViewOffers: (pos: Position) => void;
}) => (
  <>
    {/* Overlay */}
    <div
      onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: 10 }}
    />

    {/* Sheet */}
    <div className="geo-sheet">
      <div className="geo-sheet__handle" />

      <p className="geo-sheet__title">{pos.text}</p>

      <div className="geo-sheet__actions">
        {/* Directions */}
        <a
          href={mapsUrl(pos)}
          target="_blank"
          rel="noopener noreferrer"
          className="geo-sheet__btn geo-sheet__btn--primary"
        >
          <svg
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          {i18next.t("direction", "Direction")}
        </a>
      </div>
      <div className="mt-4">
        {/* Submit */}
        <button
          onClick={() => onSubmitCatalogue(pos)}
          className="geo-sheet__btn geo-sheet__btn--ghost"
        >
          {i18next.t("submit", "Submit")}
        </button>

        {/* View Offers */}
        <button onClick={() => onViewOffers(pos)} className="geo-sheet__btn">
          {i18next.t("viewOffers", "View Offers")}
        </button>
      </div>
    </div>
  </>
);
