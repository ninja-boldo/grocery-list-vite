import { memo, useState } from "react"
import "../../styles/geo.css"
import type { Position } from "./Map"

interface Props {
    setCenterPos: ( (pos: Position) => void);
    setMarkedPos: ( (positions: Position[]) => void);
    radius: number;
}

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


const GetCoordPosition = ( {setCenterPos, setMarkedPos, radius}: Props) => {
    const [status, setStatus] = useState("idle"); // idle, loading, success, error

    function getLocation() {
        if (!navigator.geolocation) {
            setStatus("error");
            return;
        }
        
        setStatus("loading");
        navigator.geolocation.getCurrentPosition(success, error);
    }

    const fetchCloseMarkets = async (pos: Position) => {
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

    async function success(position: GeolocationPosition) {
        setStatus("success");
        console.log("longitude: " + position.coords.longitude)
        console.log("latitude: " + position.coords.latitude)
        const userCoords: Position = {lat: position.coords.latitude, lon: position.coords.longitude, valid: true };
        await fetchCloseMarkets(userCoords)
        setCenterPos( userCoords )
        console.log("set the position")
        // Reset to idle after 2 seconds
        setTimeout(() => {
            setStatus("idle");
        }, 2000);
    }
    
    function error() {
        setStatus("error");
        setTimeout(() => {
            setStatus("idle");
        }, 2000);
    }

    const getStatusContent = () => {
        switch(status) {
            case "loading":
                return "📍 Getting location...";
            case "success":
                return "✓ Location captured!";
            case "error":
                return "✗ Location unavailable";
            default:
                return "📍 Get My Location";
        }
    }

    return (
        <button 
            className={`geo-button geo-button--${status}`}
            onClick={getLocation}
            disabled={status === "loading"}
        >
            {getStatusContent()}
        </button>
    )
}

export default memo(GetCoordPosition);