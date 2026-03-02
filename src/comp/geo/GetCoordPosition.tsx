import "../../styles/geo.css"
import type { Position } from "./Map"

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

export const fetchCloseMarkets = async (pos: Position, radius: number, setMarkedPos: ( (positions: Position[]) => void) ) => {
    const url = `/api/get_supermarkets_close?lat=${encodeURIComponent(pos.lat)}&lon=${encodeURIComponent(pos.lon)}&radius_meters=${encodeURIComponent(radius)}`
    const response = await fetch(url)
    if (response.ok){
        const parsedResp: ApiResponse = await response.json();
        const markedPositions: Position[] = [];
        parsedResp.results.forEach(item => {
            markedPositions.push( {lat: item.lat, lon: item.lon, text: item.name} )
        });    
        setMarkedPos(markedPositions); 
        //console.log("got this api response: " + parsedResp)    
    }
    else{
        console.error("errored for this request url: " + url + " with this status code: " + response.status);
        
    }
}
