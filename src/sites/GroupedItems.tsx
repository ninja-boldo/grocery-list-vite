import { memo, useEffect, useState } from "react";
import ContainerTagGrouped from "../comp/grouped/ContainerTagGrouped";
import SidebarComp from "../comp/other/Sidebar";


interface SubItem {
  name: string;
  count: number;
}

interface ApiItem {
  subItems: SubItem[];
  tags: string;
}

interface Items {
  [groupedName: string]: ApiItem;
}

const GroupedItems = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [parsedItems, setParsedItems] = useState<Items>({});
    const [isLoading, setIsLoading] = useState(false)


  const fetchGrouped = async () => {
    const params = new URLSearchParams({ only_wish_list: 'false' });
    const response = await fetch(`/api/fetch_grouped_items?${params}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rawText = await response.text();
    setParsedItems(JSON.parse(rawText).items);
  };

  useEffect(() => {
      console.log('GroupedItems mounted at:', performance.now());

    fetchGrouped();
    setIsLoading(false)
  }, []);

  return (

    <div className="flex flex-col min-h-screen mt-3 ">

         {isLoading ? (
                <div> currently loading...</div>
            ):(
            <>
            <div className="flex flex-row m-2">
                <SidebarComp isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
                {/* Sidebar Toggle */}
                <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="flex items-center justify-center w-12 h-12 rounded-lg hover:bg-slate-700/50 transition-colors shrink-0"
                >
                ≡
                </button>

            </div>

            <div className="flex flex-col justify-center items-center">

            {Object.entries(parsedItems).map(([groupedName, item]) => (
                <ContainerTagGrouped
                key={groupedName}
                name={groupedName}
                tags={item.tags}
                subItems={item.subItems}
                />
            ))}
            </div>
            </>    
        )}

    </div>
  );
};

export default memo(GroupedItems);
