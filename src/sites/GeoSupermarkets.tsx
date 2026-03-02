import { memo, useEffect, useState } from "react";
import { fetchCloseMarkets, getUserLocation } from "@/comp/geo/GetCoordPosition";
import Map, { type Position } from "../comp/geo/Map"
import TopBar from "@/comp/other/TopBar";
import { PageModes } from "@/lib/utils";
import Sidebar from "@/comp/other/Sidebar";

const GeoSupermarketSite = () => {
    const [userPos, setUserPos] = useState<Position>( {lon: 1, lat: 1, valid: false} );
    const [markedPositions, setMarkedPositions] = useState<Position[]>([]);
    const [, setError] = useState<string | null>(null);
    const [supermarketRadius,] = useState<number>(3000); // this is in meters
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

    useEffect(() => {
        console.log("trying")
        getUserLocation()
            .then((coords) => setUserPos({ lat: coords.latitude, lon: coords.longitude, valid: true }))
            .catch((err) => setError(err.message));
    }, []);

useEffect(() => {
    if (userPos.valid) {
        fetchCloseMarkets(userPos, supermarketRadius, setMarkedPositions);
        setIsLoading(false)
    }
}, [userPos, supermarketRadius]);

    return (
        <div className="h-screen flex flex-col items-center">
            <Sidebar isOpen={isSidebarOpen} onClose={ () => (null) } />
            
                <TopBar 
                sidebarOpen={isSidebarOpen}
                onSidebarToggle={ () => (setIsSidebarOpen(!isSidebarOpen)) }
                onScanIncrease={() => (null) }
                onScanDecrease={ () => (null) }
                onFilter={ () => (null) }
                onReset={ () => (null) }
                items={[]}
                setItems={ () => (null) }
                mode={PageModes.GeoPage}
                />
            {isLoading ? (null) : (
                <div className="my-4 overflow-clip max-w-4xl w-full p-2">
                    <Map key={`${userPos.lat}-${userPos.lon}`} heightNum={550}  zoom={12} centerPos={userPos} markedPositions={markedPositions} />
                </div>
            )}
        </div>
    )
} 

export default memo(GeoSupermarketSite);