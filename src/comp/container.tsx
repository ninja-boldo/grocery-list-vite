import { useState } from "react";
import { ChevronRight } from "lucide-react"; 

interface Props {
  text: string | null;
  subgroups: Props[] | null;
  level: number;
  style?: string;
}

const Container = ({ text, subgroups, level, style }: Props) => {
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

  return (
    <>
      <div className={`mb-2 ${getIndentClass(level)}`}>
        <div
          onClick={() => setOpen(!open)}
          className={`
            flex items-center cursor-pointer
            border-2 border-blue-500
            bg-green-700 rounded-xl
            px-4 py-2 transition-colors
            hover:bg-green-600
            w-fit min-w-0
            ${style || ""}
          `}
        >
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
      </div>

      {open && subgroups?.length ? (
        <div className="w-full">
          {subgroups.map((el, i) => (
            <Container
              key={i}
              text={el.text}
              subgroups={el.subgroups}
              level={el.level}
              style={el.style}
            />
          ))}
        </div>
      ) : null}
    </>
  );
};

export default Container;