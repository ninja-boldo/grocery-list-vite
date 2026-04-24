import "../../styles/geo.css";
import type { Position } from "./Map";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import { buildGetSupermarketsCloseUrl } from "@/lib/api/openapi";

interface ApiItem {
  name: string;
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  brand?: string;
  chain?: string;
  opening_str?: string;
  opening_hours?: string;
}

interface ApiResponse {
  results: ApiItem[];
  count: number;
}

export const getUserLocation = (): Promise<GeolocationCoordinates> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
    );
  });
};

export const fetchCloseMarkets = async (
  pos: Position,
  radius: number,
  setMarkedPos: (positions: Position[]) => void,
  onAuthError: () => void,
) => {
  const url = buildGetSupermarketsCloseUrl({
    lat: pos.lat,
    lon: pos.lon,
    radiusMeters: radius,
  });

  if (!hasStoredJwtToken()) {
    onAuthError();
    return;
  }

  try {
    const parsedResp = await authApiCall<ApiResponse>(url, undefined, {
      retries: 1,
      onUnauthorized: onAuthError,
    });

    const markedPositions: Position[] = [];
    parsedResp.results.forEach((item) => {
      const lat = item.latitude ?? item.lat;
      const lon = item.longitude ?? item.lon;
      if (typeof lat !== "number" || typeof lon !== "number") {
        return;
      }

      const label = (
        item.name ||
        item.brand ||
        item.chain ||
        "Supermarket"
      ).trim();
      markedPositions.push({ lat, lon, text: label });
    });
    setMarkedPos(markedPositions);
  } catch (err) {
    if (err instanceof Error && err.message.includes("401")) {
      return;
    }
    console.error("errored for this request url: " + url, err);
  }
};
