import { useNavigate } from 'react-router-dom';
import './App.css';
import Container from './comp/Container';
import { useEffect, useState } from 'react';

interface Props {
  text: string | null;
  subgroups: Props[] | null;
  level: number;
  style?: string;
  onClick: (clickedNode: Props) => void;
}



function App() {

  const usenav = useNavigate()

  const [nestedData, setNestedData] = useState<Props>({
    text: "Drinks",
    level: 0,
    style: "",
    onClick: (clickedNode: Props) => { navigateScanner(clickedNode) },
    subgroups: [
      { text: "Milk", level: 0, style: "", onClick: (clickedNode: Props) => { navigateScanner(clickedNode) }, subgroups: null },
      {
        text: "Water",
        level: 0,
        style: "",
        onClick: (clickedNode: Props) => { navigateScanner(clickedNode) }, subgroups: [
          { text: "Sparkling", level: 0, style: "", onClick: (clickedNode: Props) => { navigateScanner(clickedNode) }, subgroups: null },
          { text: "Still", level: 0, style: "", onClick: (clickedNode: Props) => { navigateScanner(clickedNode) }, subgroups: null },
        ],
      },
      { text: "Coffee", level: 0, style: "", onClick: (clickedNode: Props) => { navigateScanner(clickedNode) }, subgroups: null },
    ],
  });

  useEffect(() => {
    const findContainer = (root: Props, text: string): Props | null => {
      if (root.text === text) {
        return root;
      }

      if (root.subgroups) {
        for (const subgroup of root.subgroups) {
          const found = findContainer(subgroup, text);
          if (found) {
            return found;
          }
        }
      }
      return null;
    };
    

    const addElementToData = (data: Props, parentName: string, newElement: Props): Props => {
      const newData = JSON.parse(JSON.stringify(data)); // Deep clone
      const parent = findContainer(newData, parentName);
      
      if (!parent) {
        console.warn(`Parent "${parentName}" not found. Available nodes:`, getAllNodeNames(newData));
        console.log("new data out of line 64 : " + newData[0])
        return newData;
      }

      
      if (!parent.subgroups) parent.subgroups = [];
      parent.subgroups.push(newElement);
      console.log(`Successfully added "${newElement.text}" to "${parentName}"`);
      return newData;
    };

    // Helper function to clean text (remove nested array notation)
    const cleanText = (text: string): string => {
      // Remove outer brackets and quotes if they exist
      let cleaned = text.trim();
      
      // Handle nested array notation like "[['text']]"
      if (cleaned.startsWith("[[") && cleaned.endsWith("]]")) {
        // Extract content between [[ and ]]
        cleaned = cleaned.slice(2, -2);
        
        // Remove quotes if present
        if ((cleaned.startsWith("'") && cleaned.endsWith("'")) || 
            (cleaned.startsWith('"') && cleaned.endsWith('"'))) {
          cleaned = cleaned.slice(1, -1);
        }
        
        // Handle escaped quotes
        cleaned = cleaned.replace(/\\'/g, "'").replace(/\\"/g, '"');
      }
      
      return cleaned;
    };

    // Helper function to debug available nodes
    const getAllNodeNames = (root: Props): string[] => {
      const names = [root.text!];
      if (root.subgroups) {
        for (const sub of root.subgroups) {
          names.push(...getAllNodeNames(sub));
        }
      }
      return names;
    };

    const fetchItems = async () => {
      try {
        const req = await fetch("api/fetch_items");
        
        if (!req.ok) {
          throw new Error(`HTTP error! Status: ${req.status}`);
        }

        const data = await req.json();
        console.log(data.item_list);

        type ItemArray = [string, string, string];

        const idx = data.item_list.findIndex((element: ItemArray) => 
          Array.isArray(element) && element.length > 2 && element[2] === ""
        );

        if (idx !== -1) {
          // Start with the root element
          let newNestedData: Props = {
            text: cleanText(data.item_list[idx][1]),
            level: 0,
            style: "",
            subgroups: [], 
            onClick: (clickedNode: Props) => { navigateScanner(clickedNode) },

          };

          // Remove the root element from the array
          data.item_list.splice(idx, 1);

          // Process and sort elements by path depth (parents first)
          const processedElements = [];
          console.log("data item_list: " + data.item_list)
          for (const element of data.item_list) {
            if (Array.isArray(element) && element.length > 2) {
              if (typeof element[2] === 'string') {
                element[2] = element[2].split(",");
              } else {
                console.error("element[2] is not a string:", element[2]);
                continue;
              }
            } else {
              console.error("element does not have enough elements:", element);
              continue;
            }

            processedElements.push({
              text: cleanText(element[1]),
              path: element[2],
              depth: element[2].length
            });
          }

          // Sort by path depth (shorter paths = parents come first)
          processedElements.sort((a, b) => a.depth - b.depth);

          console.log("Processing elements in order:", processedElements);

          // Now process elements in the correct order
          for (const element of processedElements) {
            console.log(`Processing element: ${element.text} with path:`, element.path);

            // Determine parent name - if path is empty, use root text
            let parentName: string;
            if (element.path.length === 0) {
              parentName = newNestedData.text!;
            } else {
              parentName = element.path[element.path.length - 1];
            }
            
            console.log(`Trying to add "${element.text}" to parent "${parentName}"`);
            
            newNestedData = addElementToData(newNestedData, parentName, {
              text: element.text,
              level: 0,
              subgroups: [],
              onClick: (clickedNode: Props) => { navigateScanner(clickedNode) },
            });
          }

          // Set the final data structure in one go
          setNestedData(newNestedData);
        }

      } catch (error) {
        console.error("Error fetching items:", error);
      }
    };

    fetchItems();
  }, []); 


  const getParentList = (root: Props, text: string, arr: string[]): string[] | null => {
      if (root.text === text) {
        return arr;
      }

      if (root.subgroups) {
        for (const subgroup of root.subgroups) {
          const arr_ = arr
          if (root.text){
            arr_.push(root.text)
          }

          const found = getParentList(subgroup, text, arr_);
          if (found) {
            return arr;
          }
        }
      }
      return null;
    };


  const navigateScanner = (clickedNode: Props) => {

    console.log("navigate scanner function invoked")
    if(clickedNode.text){
      const parents: string[] | null = getParentList(nestedData, clickedNode.text, [])
      
      if(parents){
        let parents_string = ""
        for (const parent of parents){
          parents_string += parent + ","
        }
        parents_string = parents_string.slice(0, -1)
        console.log("the parents extracted in the navigate scanner function: " + parents_string)
        usenav(`/scanner?subgroups=${parents_string}`)
      }
    }
    console.error("the clicked node seemed to be a weird one with null as text and therefore the redirect wasnt succesful")
  }

  return (
    <div className="w-full max-w-4xl h-screen">
      <Container
        text={nestedData.text}
        subgroups={nestedData.subgroups}
        level={nestedData.level}
        style={nestedData.style}
        onClick= {(clickedNode: Props) => { navigateScanner(clickedNode) }}
      />
    </div>
  );
}

export default App;