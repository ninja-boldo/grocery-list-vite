import { memo, useCallback, useState } from "react";
import Map, { Marker } from "react-map-gl/maplibre";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../styles/geo.css";
import { BottomSheet, Pin } from "./BottomSheet";
import { authApiCall } from "@/lib/authApi";
import CatalogueUploadModal, {
  type CatalogueSubmitPayload,
} from "./CatalogueUploadModal";
import type { OfferCardProps } from "./OfferCard";
import OfferModal from "./OfferModal";

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
  height?: string;
  width?: string;
}

const tileStyle = (): StyleSpecification => ({
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 20,
      paint: {
        "raster-saturation": -0.55,
        "raster-brightness-max": 0.65,
        "raster-contrast": 0.1,
      },
    },
  ],
});

const isNullishLike = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "" ||
      normalized === "none" ||
      normalized === "null" ||
      normalized === "undefined"
    );
  }

  return false;
};

const asNullableNumber = (value: unknown): number | null => {
  if (isNullishLike(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asNumber = (value: unknown): number => {
  return asNullableNumber(value) ?? 0;
};

const asNullableText = (value: unknown): string | null => {
  if (isNullishLike(value)) {
    return null;
  }
  return String(value);
};

const asBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return Boolean(value);
};

const normalizeOffers = (payload: unknown): OfferCardProps[] => {
  if (!payload) {
    return [];
  }

  const source = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && "offers" in payload
      ? ((payload as { offers?: unknown }).offers ?? [])
      : typeof payload === "object" && payload !== null && "items" in payload
        ? ((payload as { items?: unknown }).items ?? [])
        : [payload];

  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const raw = entry as Record<string, unknown>;
      const normalPrice = asNumber(raw.normal_price ?? raw.original_price);
      const discountPrice = asNumber(raw.discount_price ?? raw.offer_price);
      const resolvedNormalPrice = normalPrice > 0 ? normalPrice : discountPrice;
      const resolvedDiscountPrice =
        discountPrice > 0 ? discountPrice : normalPrice;
      const name = asNullableText(raw.name ?? raw.item_name) ?? "Unknown item";
      const shortenedName = asNullableText(raw.shortened_name) ?? name;
      const weightG = asNullableNumber(raw.weight_g);
      const volumeMl = asNullableNumber(raw.volume_ml);

      if (
        resolvedNormalPrice <= 0 &&
        resolvedDiscountPrice <= 0 &&
        name === "Unknown item" &&
        weightG === null &&
        volumeMl === null
      ) {
        return null;
      }

      const computedRate =
        resolvedNormalPrice > 0
          ? Math.max(
              0,
              Math.min(
                1,
                (resolvedNormalPrice - resolvedDiscountPrice) /
                  resolvedNormalPrice,
              ),
            )
          : 0;
      const rateFromApi = asNullableNumber(raw.discount_rate);

      return {
        name,
        shortened_name: shortenedName,
        weight_g: weightG,
        volume_ml: volumeMl,
        normal_price: resolvedNormalPrice,
        discount_price: resolvedDiscountPrice,
        discount_rate: rateFromApi ?? computedRate,
        is_app_offer: asBoolean(raw.is_app_offer),
      };
    })
    .filter((offer): offer is OfferCardProps => Boolean(offer));
};

const MapComponent = ({
  zoom,
  centerPos,
  markedPositions,
  height,
  width,
}: Props) => {
  const [activePopup, setActivePopup] = useState<Position | null>(null);
  const [catalogueTarget, setCatalogueTarget] = useState<Position | null>(null);
  const [isCatalogueOpen, setIsCatalogueOpen] = useState(false);
  const [offersTarget, setOffersTarget] = useState<Position | null>(null);
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [offers, setOffers] = useState<OfferCardProps[]>([]);
  const [isOffersLoading, setIsOffersLoading] = useState(false);
  const [offersError, setOffersError] = useState<string | null>(null);

  const submitCatalogue = useCallback(
    async (payload: CatalogueSubmitPayload) => {
      if (!catalogueTarget) {
        throw new Error("No map position selected for catalogue upload.");
      }

      const formData = new FormData();
      formData.append("catalogue", payload.file);
      formData.append("lat", String(catalogueTarget.lat));
      formData.append("lon", String(catalogueTarget.lon));

      await authApiCall("/api/post_catalogue", {
        method: "POST",
        body: formData,
      });
    },
    [catalogueTarget],
  );

  const openSubmitCatalogue = useCallback((pos: Position) => {
    setCatalogueTarget(pos);
    setIsCatalogueOpen(true);
    setActivePopup(null);
  }, []);

  const closeSubmitCatalogue = useCallback(() => {
    setIsCatalogueOpen(false);
  }, []);

  const viewOffers = useCallback(async (pos: Position) => {
    setActivePopup(null);
    setOffersTarget(pos);
    setIsOfferModalOpen(true);
    setOffers([]);
    setOffersError(null);
    setIsOffersLoading(true);

    try {
      const params = new URLSearchParams();
      params.append("longitude", pos.lon.toString());
      params.append("latitude", pos.lat.toString());
      params.append("DeprecationDays", "30");

      const headers = new Headers();
      let authToken = localStorage.getItem("jwt_auth");
      authToken = authToken?.includes("Bearer")
        ? authToken
        : "Bearer " + authToken;

      headers.append("Authorization", authToken);

      const res = await fetch(
        `/api/get_catalogue_offers?${params.toString()}`,
        { headers },
      );
      if (!res.ok) {
        throw new Error(`Failed to load offers (${res.status})`);
      }

      const payload: unknown = await res.json();
      setOffers(normalizeOffers(payload));
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not load offers right now.";
      setOffersError(message);
    } finally {
      setIsOffersLoading(false);
    }
  }, []);

  const closeOfferModal = useCallback(() => {
    setIsOfferModalOpen(false);
  }, []);

  const handleMarkerClick = useCallback(
    (pos: Position) => setActivePopup((p) => (p === pos ? null : pos)),
    [],
  );

  if (!centerPos?.valid) return null;

  return (
    <div
      className="geo-map"
      style={{
        height: height ? `${height}` : "100dvh",
        maxWidth: width ? `${width}` : undefined,
      }}
    >
      <Map
        initialViewState={{
          longitude: centerPos.lon,
          latitude: centerPos.lat,
          zoom,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={tileStyle()}
        scrollZoom={true}
        touchPitch={true}
      >
        {/* <NavigationControl position="bottom-right" showCompass={false} /> */}
        {markedPositions.map((pos, i) => (
          <Marker
            key={i}
            longitude={pos.lon}
            latitude={pos.lat}
            anchor="bottom"
            onClick={() => handleMarkerClick(pos)}
          >
            <Pin active={activePopup === pos} />
          </Marker>
        ))}
      </Map>

      {activePopup && (
        <BottomSheet
          pos={activePopup}
          onClose={() => setActivePopup(null)}
          onSubmitCatalogue={openSubmitCatalogue}
          onViewOffers={viewOffers}
        />
      )}

      <CatalogueUploadModal
        isOpen={isCatalogueOpen}
        onClose={closeSubmitCatalogue}
        submitCatalogue={submitCatalogue}
      />

      <OfferModal
        isOpen={isOfferModalOpen}
        onClose={closeOfferModal}
        offers={offers}
        isLoading={isOffersLoading}
        error={offersError}
        title={offersTarget?.text ?? "Offers"}
      />

      <div className="geo-badge">
        {markedPositions.length} location
        {markedPositions.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
};

export default memo(MapComponent);
