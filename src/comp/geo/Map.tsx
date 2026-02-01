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
    return (
        <div className="flex justify-center align-items">
        {(centerPos?.valid && markedPositions.length > 0) && (
            <MapContainer 
                center={[centerPos.lat, centerPos.lon]} 
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
                                {pos.text}
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