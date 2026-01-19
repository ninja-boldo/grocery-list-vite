import { memo, useEffect, useState } from "react";
import ContainerTagGrouped from "../comp/ContainerTagGrouped"

const GroupedItems = () => {

    const [items, setItems]: CompositeItems[] = useState([
        { name: "vinegar", count: 1 },
        { name: "apple", count: 2 },
        { name: "liquid", count: 3 },
        ]);

    const fetchGrouped = async ()  => {
        const params = new URLSearchParams({ only_wish_list: 'false' });
        //params.set('tagToInlcude', "none");

        const response = await fetch(`/api/fetch_grouped_items?${params}`)
        console.log("Fetch completed, status:", response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        // Get raw text first
        const rawText = await response.text();
        
        // Try to parse
        const parsed = JSON.parse(rawText);
        return parsed
    }
    useEffect( () => {
        
    }, [])
    return (
        <div className="flex flex-col justify-center items-center">
            <ContainerTagGrouped name="cidar" tags="vinegar, apple, liquid" subItems={ items } />
        </div>
    )
}

export default memo(GroupedItems);