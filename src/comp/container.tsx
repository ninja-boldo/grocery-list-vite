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

  return (
    <>
      <div
        onClick={() => setOpen(!open)}
        className={`
          flex items-center cursor-pointer
          border-2 border-blue-500
          bg-green-700 rounded-xl
          px-4 py-2 transition-colors
          hover:bg-green-600
          ${style || ""}
        `}
        style={{ marginLeft: level * 16 }}  // indent wrapper
      >
        
        { subgroups && subgroups.length != 0 ?
            (<ChevronRight
            size={16}
            className={`transform transition-transform ${
                open ? "rotate-90" : "rotate-0"
            }`}
            />
        ): null
        
        }
        {/* Text label */}
        <p className="ml-2">{text}</p>
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
