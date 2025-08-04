import { useNavigate } from 'react-router-dom';
import './App.css';
import Container from './comp/Container';
import { useCallback, useEffect, useState } from 'react';
import ErrorContainer from './comp/ErrorContainer';


interface Props {
  text: string | null;
  subgroups: string | null;
  style?: string;
  onClick: (clickedNode: Props) => void;
}

function App() {
  const usenav = useNavigate()

  const navigateScanner = useCallback((clickedNode: Props) => {
    const subgroups = clickedNode.subgroups || "";
    usenav(`/scanner?text=${subgroups}`);
  }, [usenav]);

  // const reloadWindow = useCallback(() => {
  //   window.location.reload();
  // }, [])

    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<Props[]>([
      {
      text: "none",
      subgroups: "fridge",
      style: "", 
      onClick: (clickedNode: Props) => {navigateScanner(clickedNode)}
    }
  ])

  

useEffect(() => {

  const fetchItems = async () => {

    // the structure is a 3 element arary with index 0 being the ean, index 1 is the item name and index 2 represents the subgroups
   fetch("/api/fetch_items")
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })

    .then(data => {
      const temp_data: Props[] = []

      console.log("Success. we have gotten back this data:", data.item_list);
      for(const row of data.item_list){
        
        //const ean = row[0]
        const item_name = row[1]
        const subgroups = row[2]

        temp_data.push({
          text: item_name,
          subgroups: subgroups,
          style: "",
          onClick: (clickedNode: Props) => navigateScanner(clickedNode)
        })
      }
      setData(temp_data)
    })

    .catch(error => {
      setError(error.message || error.string)
      console.error("Fetch failed:", error);
    });
  }

    fetchItems()
  }, [navigateScanner])

return (
  <>
    {error != null ? (
      <ErrorContainer text={error} />
    ) : (
      data.map((element, idx) => (
        <Container
          key={idx}
          text={element.text}
          subgroups={element.subgroups}
          onClick={navigateScanner}
          style=""
        />
      ))
    )}
  </>
);

};

export default App;