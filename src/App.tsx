import './App.css';
import Container from './comp/Container';
import { useCallback, useEffect, useState } from 'react';
import ErrorContainer from './comp/ErrorContainer';
import DropdownComp from './comp/Dropdown';

interface Props {
  text: string | null;
  subgroups: string | null;
  style?: string;
  count: number;
  onClickIncrease: (clickedNode: Props) => void; 
  onClickDecrease: (clickedNode: Props) => void; 
}

function App() {
  //const usenav = useNavigate();

  // const navigateScanner = useCallback((clickedNode: Props) => {
  //   const subgroups = clickedNode.subgroups || "";
  //   usenav(`/scanner?text=${subgroups}`);
  // }, [usenav]);
  

  const fetchItems =  useCallback( async(subgroups: string | null) => {
      try {
        let response
        if(subgroups) {
          response = await fetch(`/api/fetch_items?subgroups=${encodeURIComponent(subgroups)}`);
        }
        else{
          response = await fetch(`/api/fetch_items`);
        }
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();

        const temp_data: Props[] = data.item_list.map((row: [string, string, string, () => void, () => void]) => ({
          text: row[1],
          subgroups: row[2],
          style: "",
          count: row[4],
          onClickIncrease: increaseItemCount,
          onClickDecrease: decreaseItemCount
        }));


        setData(temp_data);
      } catch (error: any) {
        setError(error.message || String(error));
        console.error("Fetch failed:", error);
      }
    }, [])


  const increaseItemCount = useCallback((clickedNode: Props) => {
    if(clickedNode.text){
      fetch(`/api/add_ean_to_list/?item_name=${encodeURIComponent(clickedNode.text)}&count=+1`);
      reloadWindow()
    } else {
      console.error("Increase: clickedNode.text is invalid:", clickedNode.text);
    }
  }, [])

  const decreaseItemCount = useCallback((clickedNode: Props) => {
    if(clickedNode.text){
      fetch(`/api/remove/?te=${encodeURIComponent(clickedNode.text)}&count=-1`);
      window.location.reload();
    } else {
      console.error("Decrease: clickedNode.text is invalid:", clickedNode.text);
    }
  }, [])

  const reloadWindow = () => {
    window.location.reload();
  }

  const fetchSubgroups = (): Promise<string[]> => {
    return fetch("/api/fetch_subgroups")
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        return data.subgroups;
      });
  };

  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Props[]>([]);
  const [subgroups, setSubgroups] = useState<string[]>([]);

  useEffect(() => {
  

    fetchItems(null);

    fetchSubgroups()
      .then(setSubgroups)
      .catch(error => {
        setError(error.message || String(error));
        console.error("Failed to fetch subgroups:", error);
      });
  }, [fetchItems]);

  return (
    <>
      {error ? (
        <ErrorContainer text={error} />
      ) : (
        <>
          <DropdownComp elements={subgroups} onClickElement={fetchItems} onClickReset={fetchItems} />
          {data.map((element, idx) => (
            <Container
              key={idx}
              text={element.text}
              subgroups={element.subgroups}
              count={element.count}
              onClickIncrease={increaseItemCount}
              onClickDecrease={decreaseItemCount}
              style=""
            />
          ))}
        </>
      )}
    </> 
  );
}

export default App;
