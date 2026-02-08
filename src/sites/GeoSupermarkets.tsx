import { memo, useState } from "react";
import GetCoordPosition from "../comp/geo/GetCoordPosition"
import Map, { type Position } from "../comp/geo/Map"

const GeoSupermarketSite = () => {
    const [userPos, setUserPos] = useState<Position | undefined>( {lon: 1, lat: 1, valid: false} )
    const [markedPositions, setMarkedPositions] = useState<Position[]>([]);
    return (
        <div>
            <GetCoordPosition setMarkedPos={setMarkedPositions} setCenterPos={setUserPos} radius={3000} />
            <Map heightNum={400}  zoom={12} centerPos={userPos} markedPositions={markedPositions} />
        </div>
    )
}

export default memo(GeoSupermarketSite);