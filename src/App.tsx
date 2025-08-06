import './App.css';
import Container from './comp/Container';
import { useCallback, useEffect, useState } from 'react';
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

  const navigateScanner = useCallback((clickedNode: Props | null) => {
    if(clickedNode?.subgroups){
      const subgroups = clickedNode.subgroups || "";
      usenav(`/scanner?text=${subgroups}`);
    }

    else{
      usenav(`/scanner?text=`);
    }
  }, [usenav]);
  

  const fetchItems =  useCallback( async(subgroups: string | null, classnames: string | null) => {
      try {
        let response
        if(subgroups) {
          response = await fetch(`/api/fetch_items?subgroups=${encodeURIComponent(subgroups)}`);
        }
        else if(classnames){
          response = await fetch(`/api/fetch_items?classnames=${encodeURIComponent(classnames)}`);

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
          classname: row[3],
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

    const fetchClassnames = (): Promise<string[]> => {
      return fetch("/api/fetch_classnames")
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          return data.classnames;
        });
    }

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
      fetch(`/api/add_ean_to_list/?item_name=${encodeURIComponent(clickedNode.text)}&count=-1`);
      reloadWindow()
    } else {
      console.error("Decrease: clickedNode.text is invalid:", clickedNode.text);
    }
  }, [])

  const reloadWindow = () => {
    window.location.reload();
  }

  

  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Props[]>([]);
  const [subgroups, setSubgroups] = useState<string[]>([]);
  const [classnames, setClassnames] = useState<string[]>([]);


  useEffect(() => {
  

    fetchItems(null, null);

    fetchSubgroups()
      .then(setSubgroups)
      .catch(error => {
        setError(error.message || String(error));
        console.error("Failed to fetch subgroups:", error);
      });

    fetchClassnames()
      .then(setClassnames)
      .catch(error => {
        setError(error.message || String(error));
        console.error("Failed to fetch subgroups:", error);
      });

      console.warn("fetched the following classnames: " + classnames)

  }, [fetchItems]);

  return (
  <div className="flex flex-col justify-start min-h-screen">
    {error ? (
      <ErrorContainer text={error} />
    ) : (
      <>
        <div className="flex items-center gap-4 mb-4 ml-4">
          <div>
            <DropdownComp task={"subgroups"} elements={subgroups} onClickElement={fetchItems} onClickReset={fetchItems} style={""} />
          </div>
          <div>
            <DropdownComp task={"classnames"} elements={classnames} onClickElement={fetchItems} onClickReset={fetchItems} style={""} />
          </div>
          <div>
            <StyledButton text='scan item' onClick={navigateScanner} style={""} />
          </div>
        </div>

        {data.map((element, idx) => (
          <Container
            key={idx}
            text={element.text}
            subgroups={element.subgroups}
            count={element.count}
            classname={element.classname}
            onClickIncrease={increaseItemCount}
            onClickDecrease={decreaseItemCount}
            style=""
          />
        ))}
      </>
    )}
  </div>
  );
}

export default App;
