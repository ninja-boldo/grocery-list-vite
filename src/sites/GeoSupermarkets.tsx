import { memo, useEffect, useState } from "react";
import { fetchCloseMarkets, getUserLocation } from "@/comp/geo/GetCoordPosition";
import Map, { type Position } from "../comp/geo/Map"
import TopBar from "@/comp/other/TopBar";
import { PageModes } from "@/lib/utils";
import Sidebar from "@/comp/other/Sidebar";
import AuthPopup from "@/comp/other/AuthPopup";

const GeoSupermarketSite = () => {
    const [userPos, setUserPos] = useState<Position>( {lon: 1, lat: 1, valid: false} );
    const [markedPositions, setMarkedPositions] = useState<Position[]>([]);
    const [, setError] = useState<string | null>(null);
    const [supermarketRadius,] = useState<number>(3000); // this is in meters
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
    const [needReauth, setNeedReauth] = useState(false)

    useEffect(() => {
        console.log("trying")
        getUserLocation()
            .then((coords) => setUserPos({ lat: coords.latitude, lon: coords.longitude, valid: true }))
            .catch((err) => setError(err.message));
    }, []);

useEffect(() => {
    if (!userPos.valid) {
        return;
    }

    setIsLoading(true)
    fetchCloseMarkets(userPos, supermarketRadius, setMarkedPositions, () => setNeedReauth(true))
        .catch((err) => setError(err?.message ?? 'Failed to fetch nearby supermarkets.'))
        .finally(() => setIsLoading(false))
}, [userPos, supermarketRadius, setError]);

    return (
        <div className="h-screen flex flex-col">
            {
                needReauth && <AuthPopup onAuthenticated={ () => setNeedReauth(false)} />
            }
            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} setNeedReauth={setNeedReauth} />
            
            <TopBar 
                sidebarOpen={isSidebarOpen}
                onSidebarToggle={ () => (setIsSidebarOpen(!isSidebarOpen)) }
                onScanIncrease={() => (null) }
                onScanDecrease={ () => (null) }
                onFilter={ () => undefined }
                onReset={ () => (null) }
                items={[]}
                setItems={ () => (null) }
                classNames={[]}
                selectedClass={null}
                currentSortOrder="new-old"
                mode={PageModes.GeoPage}
            />
            {isLoading ? (
                <div className="flex justify-center items-center flex-1">
                    <div style={{ color: "#5eead4", fontSize: 14 }}>Loading map...</div>
                </div>
            ) : (
                <div className="flex-1 p-3 sm:p-4 md:p-6">
                    <div className="max-w-4xl mx-auto">
                        <Map key={`${userPos.lat}-${userPos.lon}`} heightNum={550}  zoom={12} centerPos={userPos} markedPositions={markedPositions} />
                    </div>
                </div>
            )}
        </div>
    )
} 

export default memo(GeoSupermarketSite);