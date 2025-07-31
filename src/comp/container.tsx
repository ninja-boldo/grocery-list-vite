import { useState } from "react";
import { ChevronRight } from "lucide-react"; 

interface Props {
  text: string | null;
  subgroups: Props[] | null;
  level: number;
  style?: string;
  onClick: (clickedNode: Props) => void;
}

const Container = ({ text, subgroups, level, style, onClick }: Props) => {
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

  let child_level = level
  if (parent === null) {
    level = 0
    child_level = 0
  }
  else {
    child_level += 1
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

          {/* Right side: Button */}
          <button 
            onClick={(e) => {
              e.stopPropagation(); // prevent toggling the group accidentally
              onClick({ text, subgroups, level, style, onClick });
            }}
            className="bg-gray-800 text-white px-3 py-1 rounded text-sm hover:bg-gray-700 transition-colors ml-4 flex-shrink-0"
          >
            add item
          </button>
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
            />
          ))}
        </div>
      ) : null}
    </>
  );
};

export default Container;