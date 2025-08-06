import { useState } from "react";

interface Props {
  text: string | null;
  subgroups: string | null;
  style?: string;
  count: number;
  classname: string | null;
  onClickIncrease: (clickedNode: Props) => void; 
  onClickDecrease: (clickedNode: Props) => void; 
}

const Container = ({ text, subgroups, style, count, classname, onClickIncrease, onClickDecrease }: Props) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4 px-4">
      <div
        onClick={() => setOpen(!open)}
        className={`
          group relative
          flex items-center cursor-pointer
          bg-gradient-to-r from-slate-900/90 to-slate-800/90
          border border-cyan-500/30
          rounded-2xl shadow-lg shadow-cyan-500/10
          p-4 transition-all duration-300
          hover:shadow-xl hover:shadow-cyan-400/20
          hover:border-cyan-400/50
          hover:from-slate-800/95 hover:to-slate-700/95
          w-full
          backdrop-blur-md
          ${style || ""}
        `}
      >
        {/* Neon accent glow */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-cyan-400 via-cyan-500 to-blue-500 rounded-r-full shadow-lg shadow-cyan-500/50 group-hover:shadow-cyan-400/70 transition-all duration-300"></div>
        
        {/* Main content area */}
        <div className="flex items-center justify-between w-full ml-4">
          {/* Left side - Item name */}
          <div className="flex-1 min-w-0 mr-4">
            <p className="text-cyan-100 font-medium text-base truncate group-hover:text-cyan-50 transition-colors">
              {text}
            </p>
          </div>

          {/* Middle section - Count, Subgroups, Classnames */}
          <div className="flex items-center gap-3">
            {/* Count */}
            <span className="text-slate-200/60 text-xs font-mono px-2 py-1 rounded-md bg-slate-800/40 border border-slate-600/30 whitespace-nowrap">
              {count}x
            </span>

            {/* Subgroups and classnames container */}
            <div className="hidden sm:flex flex-col gap-1">
              <span className="text-slate-300/60 text-xs font-mono px-2 py-1 rounded-md bg-slate-800/40 border border-slate-600/30 whitespace-nowrap">
                {subgroups || "None"}
              </span>
              <span className="text-slate-300/60 text-xs font-mono px-2 py-1 rounded-md bg-slate-800/40 border border-slate-600/30 whitespace-nowrap">
                {classname || "None"}
              </span>
            </div>

            {/* Mobile - show subgroups and classnames inline */}
            <div className="flex sm:hidden flex-col gap-1">
              <span className="text-slate-300/60 text-xs font-mono px-1 py-1 rounded-md bg-slate-800/40 border border-slate-600/30 max-w-16 truncate">
                {subgroups || "None"}
              </span>
              <span className="text-slate-300/60 text-xs font-mono px-1 py-1 rounded-md bg-slate-800/40 border border-slate-600/30 max-w-16 truncate">
                {classname || "None"}
              </span>
            </div>
          </div>

          {/* Right side - Buttons */}
          <div className="flex items-center gap-2 ml-4">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onClickIncrease({ text, subgroups, style, count, classname, onClickIncrease, onClickDecrease });
              }}
              className="
                relative overflow-hidden
                w-10 h-10
                bg-gradient-to-br from-emerald-500/90 to-emerald-600/90
                text-white font-bold text-lg
                rounded-xl shadow-lg shadow-emerald-500/25
                hover:from-emerald-400/95 hover:to-emerald-500/95
                hover:shadow-xl hover:shadow-emerald-400/40 
                hover:scale-105
                active:scale-95
                transition-all duration-200
                flex justify-center items-center
                border border-emerald-400/40
                before:absolute before:inset-0 before:bg-white/10 before:translate-x-[-100%] 
                hover:before:translate-x-[100%] before:transition-transform before:duration-500
                flex-shrink-0
              ">
              +
            </button>
            
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onClickDecrease({ text, subgroups, style, count, classname, onClickIncrease, onClickDecrease });
              }}
              className="
                relative overflow-hidden
                w-10 h-10
                bg-gradient-to-br from-rose-500/90 to-pink-600/90
                text-white font-bold text-lg
                rounded-xl shadow-lg shadow-rose-500/25
                hover:from-rose-400/95 hover:to-pink-500/95
                hover:shadow-xl hover:shadow-rose-400/40 
                hover:scale-105
                active:scale-95
                transition-all duration-200
                flex justify-center items-center
                border border-rose-400/40
                before:absolute before:inset-0 before:bg-white/10 before:translate-x-[-100%] 
                hover:before:translate-x-[100%] before:transition-transform before:duration-500
                flex-shrink-0
              ">
              −
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Container;