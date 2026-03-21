import "../../styles/geo.css"
import type { Position } from "./Map"
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi"

interface ApiItem {
  name: string;
  lat: number;
  lon: number;
  street: string;
  housenumber: string;
  openingHours: string;
  website: string;
  brand: string;
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

export const fetchCloseMarkets = async (pos: Position, radius: number, setMarkedPos: ((positions: Position[]) => void), onAuthError: () => void) => {
  const url = `/api/get_supermarkets_close?lat=${encodeURIComponent(pos.lat)}&lon=${encodeURIComponent(pos.lon)}&radius_meters=${encodeURIComponent(radius)}`

  if (!hasStoredJwtToken()) {
    onAuthError()
    return
  }

  try {
    const parsedResp = await authApiCall<ApiResponse>(url, undefined, {
      retries: 1,
      onUnauthorized: onAuthError,
    })

    const markedPositions: Position[] = [];
    parsedResp.results.forEach(item => {
      markedPositions.push({ lat: item.lat, lon: item.lon, text: item.name })
    });
    setMarkedPos(markedPositions);
  } catch (err) {
    if (err instanceof Error && err.message.includes('401')) {
      return
    }
    console.error("errored for this request url: " + url, err);
  }
}
