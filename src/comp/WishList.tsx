import '../App.css';
import Container from './Container';
import { useCallback, useEffect, useState, useMemo } from 'react';
import ErrorContainer from './ErrorContainer';
import { useNavigate } from 'react-router-dom';
import StyledButton from './StyledButton';

import { Bars3Icon } from '@heroicons/react/24/outline'
import SidebarComp from "./Sidebar"

interface Props {
  text: string | null;
  subgroups: string | null;
  style?: string;
  count: number;
  classname: string | null;
  perish_dates: string | null;
  onClickIncrease: (clickedNode: Props) => void; 
  onClickDecrease: (clickedNode: Props) => void; 
}

function WishList() {
  const usenav = useNavigate();

  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Props[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [SidebarIsOpen, setSidebarIsOpen] = useState(false)

  const navigateScanner = useCallback((clickedNode: Props | null, count: number | null) => {

    if(!count){
      count = 1
    }
    if(clickedNode?.subgroups){
      const subgroups = clickedNode.subgroups || "";
      usenav(`/scanner?subgroups=${encodeURIComponent(subgroups)}&count=${encodeURIComponent(count)}&wishlist=true`);
    } else {
      usenav(`/scanner?text=&count=${encodeURIComponent(count)}&wishlist=true`);
    }
  }, [usenav]);

  const increaseItemCount = useCallback(async (clickedNode: Props) => {
    if(clickedNode.text){
      setIsLoading(true);
      try {
        await fetch(`/api/add_ean_to_list/?item_name=${encodeURIComponent(clickedNode.text)}&count=+1&wish_list=true`);
        // Instead of reloading, update state locally for better UX
        setData(prevData => 
          prevData.map(item => 
            item.text === clickedNode.text 
              ? { ...item, count: item.count + 1 }
              : item
          )
        );
      } catch (error) {
        console.error("Failed to increase count:", error);
        setError("Failed to update item count");
      } finally {
        setIsLoading(false);
      }
    } else {
      console.error("Increase: clickedNode.text is invalid:", clickedNode.text);
    }
  }, []);

  const decreaseItemCount = useCallback(async (clickedNode: Props) => {
  if (!clickedNode.text) {
    console.error("Decrease: clickedNode.text is invalid:", clickedNode.text);
    return;
  }

  setIsLoading(true);
  try {
    await fetch(
      `/api/add_ean_to_list/?item_name=${encodeURIComponent(
        clickedNode.text
      )}&count=-1
      &wish_list=true`
    );

    let shouldReload = false;
    setData(prevData =>
      prevData.map(item => {
        if (item.text !== clickedNode.text) {
          return item;
        }
        const newCount = Math.max(0, item.count - 1);
        if (newCount < 1) {
          shouldReload = true;
        }
        return { ...item, count: newCount };
      })
    );

    if (shouldReload) {
      location.reload();
    }
  } catch (err) {
    console.error("Failed to decrease count:", err);
    setError("Failed to update item count");
  } finally {
    setIsLoading(false);
  }
}, []);



  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
        console.log("fetched the wishlist with this url: " + `/api/fetch_items?only_wish_list=true`)
        const response = await fetch(`/api/fetch_items?only_wish_list=true`);
      
      

      interface ApiResponse {
        item_list: [string, string, string, string, number, string][];  // or whatever the actual structure is
      }

      interface RawItem {
        0: string;  // assuming first element
        1: string;  // text
        2: string; // subgroups
        3: string;  // classname
        4: number;  // count
        5: string; // timestamps
      }

      // Then use them:
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const responseData: ApiResponse = await response.json();

      const temp_data: Props[] = responseData.item_list.map((row: RawItem) => ({
        text: row[1],
        subgroups: row[2],
        style: "",
        classname: row[3],
        count: row[4],
        perish_dates: row[5],
        onClickIncrease: increaseItemCount,
        onClickDecrease: decreaseItemCount
      }));

      setData(temp_data);
    } 
    catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
      console.error("Fetch failed:", error);
    } finally {
      setIsLoading(false);
    }

  }, [increaseItemCount, decreaseItemCount]);


  const containerComponents = useMemo(() => {
    return data.map((element, idx) => (
      <Container
        key={`${element.text}-${idx}`} 
        text={element.text}
        subgroups={element.subgroups}
        count={element.count}
        classname={element.classname}
        perish_dates={["none"]}
        onClickIncrease={increaseItemCount}
        onClickDecrease={decreaseItemCount}
        style=""
      />
    ));
  }, [data, increaseItemCount, decreaseItemCount]);


  useEffect(() => {
    const loadInitialData = async () => {
      try {
        await fetchItems()
      }
       catch (error) {
        setError("Failed to load initial data");
        console.error("Initial data load failed:", error);
      }
    };

    loadInitialData();
  }, [fetchItems]); 

  if (isLoading && data.length === 0) {
    return <div className="flex justify-center items-center min-h-screen"></div>;
  }

  return (
    <div className="flex flex-col justify-start min-h-screen">
      {error ? (
        <ErrorContainer text={error} />
      ) : (
        <>
        
        <div className="absolute top-0 left-0 flex items-center justify-center rounded-xl m-4 hover:bg-indigo-950 min-w-10 min-h-10"
             onClick={() => setSidebarIsOpen(!SidebarIsOpen)}>
              {SidebarIsOpen ?(
                <>
                  <div className="absolute top-0 left-0 flex items-center justify-center rounded-xl m-4 hover:bg-gray-700 min-w-10 min-h-10 z-50"
                      onClick={() => setSidebarIsOpen(!SidebarIsOpen)}>
                    <SidebarComp isOpen={SidebarIsOpen} onClose={() => setSidebarIsOpen(false)} />
                    <Bars3Icon className="h-6 w-6 text-white" />
                  </div>
                </>
              ): 
              <Bars3Icon className="h-6 w-6 text-white" />
              }
        </div>


          <div className="flex items-center gap-4 mb-4 ml-4">
            <div>
              <StyledButton text='+' onClick={() => navigateScanner(null, 1)} className='mx-2' />
              <StyledButton text='-' onClick={() => navigateScanner(null, -1)} className='mx-2' />
            </div>
            {isLoading && <div className="text-sm text-gray-500"></div>}
          </div>

          {containerComponents}
        </>
      )}
    </div>
  );
}

export default WishList;