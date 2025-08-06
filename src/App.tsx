import './App.css';
import Container from './comp/Container';
import { useCallback, useEffect, useState, useMemo } from 'react';
import ErrorContainer from './comp/ErrorContainer';
import DropdownComp from './comp/Dropdown';
import { useNavigate } from 'react-router-dom';
import StyledButton from './comp/StyledButton';

interface Props {
  text: string | null;
  subgroups: string | null;
  style?: string;
  count: number;
  classname: string | null;
  onClickIncrease: (clickedNode: Props) => void; 
  onClickDecrease: (clickedNode: Props) => void; 
}

function App() {
  const usenav = useNavigate();

  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Props[]>([]);
  const [subgroups, setSubgroups] = useState<string[]>([]);
  const [classnames, setClassnames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const navigateScanner = useCallback((clickedNode: Props | null) => {
    if(clickedNode?.subgroups){
      const subgroups = clickedNode.subgroups || "";
      usenav(`/scanner?text=${encodeURIComponent(subgroups)}`);
    } else {
      usenav(`/scanner?text=`);
    }
  }, [usenav]);

  const increaseItemCount = useCallback(async (clickedNode: Props) => {
    if(clickedNode.text){
      setIsLoading(true);
      try {
        await fetch(`/api/add_ean_to_list/?item_name=${encodeURIComponent(clickedNode.text)}&count=+1`);
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
    if(clickedNode.text){
      setIsLoading(true);
      try {
        await fetch(`/api/add_ean_to_list/?item_name=${encodeURIComponent(clickedNode.text)}&count=-1`);
        // Instead of reloading, update state locally for better UX
        setData(prevData => 
          prevData.map(item => 
            item.text === clickedNode.text 
              ? { ...item, count: Math.max(0, item.count - 1) }
              : item
          )
        );
      } catch (error) {
        console.error("Failed to decrease count:", error);
        setError("Failed to update item count");
      } finally {
        setIsLoading(false);
      }
    } else {
      console.error("Decrease: clickedNode.text is invalid:", clickedNode.text);
    }
  }, []);

  const fetchItems = useCallback(async (subgroups: string | null, classnames: string | null) => {
    setIsLoading(true);
    setError(null);
    
    try {
      let response;
      if(subgroups) {
        response = await fetch(`/api/fetch_items?subgroups=${encodeURIComponent(subgroups)}`);
      } else if(classnames) {
        response = await fetch(`/api/fetch_items?classnames=${encodeURIComponent(classnames)}`);
      } else {
        response = await fetch(`/api/fetch_items`);
      }
      
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const responseData = await response.json();

      const temp_data: Props[] = responseData.item_list.map((row: any[]) => ({
        text: row[1],
        subgroups: row[2],
        style: "",
        classname: row[3],
        count: row[4],
        onClickIncrease: increaseItemCount,
        onClickDecrease: decreaseItemCount
      }));

      setData(temp_data);
    } catch (error: any) {
      setError(error.message || String(error));
      console.error("Fetch failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [increaseItemCount, decreaseItemCount]);

  const fetchSubgroups = useCallback(async (): Promise<string[]> => {
    try {
      const response = await fetch("/api/fetch_subgroups");
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      return data.subgroups;
    } catch (error) {
      console.error("Failed to fetch subgroups:", error);
      throw error;
    }
  }, []);

  const fetchClassnames = useCallback(async (): Promise<string[]> => {
    try {
      const response = await fetch("/api/fetch_classnames");
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      return data.classnames;
    } catch (error) {
      console.error("Failed to fetch classnames:", error);
      throw error;
    }
  }, []);

  // Memoize the Container components to prevent unnecessary re-renders
  const containerComponents = useMemo(() => {
    return data.map((element, idx) => (
      <Container
        key={`${element.text}-${idx}`} // Better key using text + index
        text={element.text}
        subgroups={element.subgroups}
        count={element.count}
        classname={element.classname}
        onClickIncrease={increaseItemCount}
        onClickDecrease={decreaseItemCount}
        style=""
      />
    ));
  }, [data, increaseItemCount, decreaseItemCount]);

  // Load initial data and dropdown options
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // Run all initial fetches in parallel
        const [, subgroupsResult, classnamesResult] = await Promise.allSettled([
          fetchItems(null, null),
          fetchSubgroups(),
          fetchClassnames()
        ]);

        if (subgroupsResult.status === 'fulfilled') {
          setSubgroups(subgroupsResult.value);
        } else {
          console.error("Failed to fetch subgroups:", subgroupsResult.reason);
        }

        if (classnamesResult.status === 'fulfilled') {
          setClassnames(classnamesResult.value);
          console.warn("Fetched the following classnames:", classnamesResult.value);
        } else {
          console.error("Failed to fetch classnames:", classnamesResult.reason);
        }

      } catch (error) {
        setError("Failed to load initial data");
        console.error("Initial data load failed:", error);
      }
    };

    loadInitialData();
  }, []); // Remove fetchItems from dependency array to prevent infinite loops

  if (isLoading && data.length === 0) {
    return <div className="flex justify-center items-center min-h-screen"></div>;
  }

  return (
    <div className="flex flex-col justify-start min-h-screen">
      {error ? (
        <ErrorContainer text={error} />
      ) : (
        <>
          <div className="flex items-center gap-4 mb-4 ml-4">
            <div>
              <DropdownComp 
                task="subgroups" 
                text="subgroups" 
                elements={subgroups} 
                onClickElement={fetchItems} 
                onClickReset={fetchItems} 
                style="" 
              />
            </div>
            <div>
              <DropdownComp 
                task="classnames" 
                text="classnames" 
                elements={classnames} 
                onClickElement={fetchItems} 
                onClickReset={fetchItems} 
                style="" 
              />
            </div>
            <div>
              <StyledButton text='scan' onClick={navigateScanner} />
            </div>
            {isLoading && <div className="text-sm text-gray-500"></div>}
          </div>

          {containerComponents}
        </>
      )}
    </div>
  );
}

export default App;