import { useState } from "react";
import { ChevronRight } from "lucide-react"; 

interface Props {
  text: string | null;
  subgroups: Props[] | null;
  level: number;
  style?: string;
  onClick: (clickedNode: Props) => void; 
  parent: string | null;
}

const Container = ({ text, subgroups, level, style, onClick, parent }: Props) => {
  const [open, setOpen] = useState(false);

  // Use Tailwind padding classes instead of fixed margin
  const getIndentClass = (level: number) => {
    const indentClasses = [
      'pl-0',    // level 0
      'pl-4',    // level 1
      'pl-8',    // level 2
      'pl-12',   // level 3
      'pl-16',   // level 4
      'pl-20',   // level 5
    ];
    return indentClasses[Math.min(level, indentClasses.length - 1)] || 'pl-20';
  };

  let child_level = level;
  if (subgroups === null) {
    child_level = 0;
  } else {
    child_level += 1;
  }

  return (
    <>
      <div className={`mb-2 ${getIndentClass(level)}`}>
        <div
          onClick={() => setOpen(!open)}
          className={`
            flex items-center justify-between cursor-pointer
            border-2 border-blue-500
            bg-green-700 rounded-xl
            px-4 py-2 transition-colors
            hover:bg-green-600
            min-w-0
            w-full 
            ${style || ""}
          `}
        >
          {/* Left side: Chevron + Text */}
          <div className="flex items-center min-w-0">
            {subgroups && subgroups.length !== 0 ? (
              <ChevronRight
                size={16}
                className={`transform transition-transform flex-shrink-0 ${
                  open ? "rotate-90" : "rotate-0"
                }`}
              />
            ) : null}
            
            {/* Text label */}
            <p className="ml-2 text-white truncate">{text}</p>
          </div>

          {/* Right side: Buttons */}
          <div className="flex space-x-2">
            <button 
              onClick={(e) => {
                e.stopPropagation(); // prevent toggling the group accidentally
                onClick({ text, subgroups, level, style, onClick, parent });
              }}
              className="bg-gray-800 text-white px-3 py-1 rounded text-sm hover:bg-gray-700 transition-colors flex-shrink-0"
            >
              Add Item
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation(); 
                if (text && parent) {
                  const url = `/api/remove_item/?text=${encodeURIComponent(text)}&parent=${encodeURIComponent(parent)}`;
                  console.log("Making request to:", url);
                  console.log("Text:", text, "Parent:", parent);
                  
                  fetch(url)
                    .then(async response => {
                      setTimeout(() => {
                    
                       }, 500);
                      console.log("Response status:", response.status);
                      console.log("Response headers:", Object.fromEntries(response.headers.entries()));
                      
                      if (!response.ok) {
                        const errorText = await response.text();
                        console.log("Error response body:", errorText);
                        throw new Error(`HTTP error! Status: ${response.status}, Response: ${errorText}`);
                      }
                      
                      // Check if response is JSON
                      const contentType = response.headers.get('content-type');
                      if (contentType && contentType.includes('application/json')) {
                        return response.json();
                      } else {
                        const text = await response.text();
                        console.log("Non-JSON response:", text);
                        return { success: true, message: text };
                      }
                    })
                    .then(data => {
                      console.log("Item removed successfully:", data);
                      // You might want to trigger a refresh of your data here
                    })
                    .catch(error => {
                      console.error("Error removing item:", error);
                      // You might want to show a user-friendly error message here
                    });
                }
              }}
              className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-500 transition-colors flex-shrink-0"
            >
              Remove Item
            </button>
          </div>
        </div>
      </div>

      {open && subgroups?.length ? (
        <div className="w-full">
          {subgroups.map((el, i) => (
            <Container
              key={i}
              text={el.text}
              subgroups={el.subgroups}
              level={child_level}
              style={el.style}
              onClick={onClick} 
              parent={text}
            />
          ))}
        </div>
      ) : null}
    </>
  );
};

export default Container;