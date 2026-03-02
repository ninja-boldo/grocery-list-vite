import { memo, useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css';


export interface Position {
    lat: number;
    lon: number;
    text?: string;
    valid?: boolean;
}

interface Props {
    heightNum?: number;
    widthNum?: number;
    zoom: number;
    centerPos?: Position;
    markedPositions: Position[];
}

const Map = ( {heightNum, widthNum, zoom, centerPos, markedPositions}: Props ) => {

    const widthString: string = widthNum ? `${widthNum}px` : "80%"
    const heightString: string = heightNum ? `${heightNum}px` : "400px"

    useEffect(() => {
        console.log(`widthNum=${widthNum}, heightNum=${heightNum}, zoom=${zoom}, centerPos=${JSON.stringify(centerPos)}, markedPositions=${JSON.stringify(markedPositions)}`)
    }, [widthNum, heightNum, zoom, centerPos, markedPositions])
   

    const mapsSelector = (pos: Position): string => {
        /* iOS => open Apple Maps */
        if(
            (navigator.platform.indexOf("iPhone") != -1) || 
            (navigator.platform.indexOf("iPad") != -1) ||
            (navigator.platform.indexOf("MacIntel") != -1)
        )
            return `maps://maps.google.com/maps?daddr=${pos.lat},${pos.lon}&amp;ll=`;
        else /* else => Google Maps */
            return `https://maps.google.com/maps?daddr=${pos.lat},${pos.lon}&amp;ll=`;
        }

    return (
        <div className="flex justify-center align-items rounded-2xl">
        {(centerPos?.valid && markedPositions.length > 0) && (
            
                <MapContainer 
                    center={[centerPos.lat, centerPos.lon] as [number, number]}                    
                    zoom={zoom} 
                    scrollWheelZoom={false}
                    style={{ height: heightString, width: widthString }}
                    >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {markedPositions.map((pos: Position, idx: number) => (
                        <Marker key={idx} position={[pos.lat, pos.lon]}>
                            {pos.text && (
                                <Popup>
                                    <a href={mapsSelector(pos)}>{pos.text}</a>
                                </Popup>
                            )}
                        </Marker>
                    ))}
                </MapContainer>
        )}
        </div>
    )
}

export default memo(Map);