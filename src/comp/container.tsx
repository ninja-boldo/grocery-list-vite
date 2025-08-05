
import { useState } from "react";

interface Props {
  text: string | null;
  subgroups: string | null;
  style?: string;
  count: number;
  onClickIncrease: (clickedNode: Props) => void; 
  onClickDecrease: (clickedNode: Props) => void; 
}

const Container = ({ text, subgroups, style, count, onClickIncrease, onClickDecrease }: Props) => {
  const [open, setOpen] = useState(false);


  return (
    <>
      <div className={`mb-4`}>
        <div
          onClick={() => setOpen(!open)}
          className={`
            group relative
            flex items-center justify-between cursor-pointer
            bg-gradient-to-r from-slate-900/90 to-slate-800/90
            border border-cyan-500/30
            rounded-2xl shadow-lg shadow-cyan-500/10
            px-4 sm:px-6 py-3 sm:py-4 transition-all duration-300
            hover:shadow-xl hover:shadow-cyan-400/20
            hover:border-cyan-400/50
            hover:from-slate-800/95 hover:to-slate-700/95
            min-w-0 w-full
            backdrop-blur-md
            ${style || ""}
          `}
        >
          {/* Neon accent glow */}
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 sm:h-8 bg-gradient-to-b from-cyan-400 via-cyan-500 to-blue-500 rounded-r-full shadow-lg shadow-cyan-500/50 group-hover:shadow-cyan-400/70 transition-all duration-300"></div>
          
          <div className="flex items-center min-w-0 flex-1 mr-3">            
            {/* Text label */}
            <p className="ml-3 sm:ml-4 text-cyan-100 font-medium text-sm sm:text-base truncate group-hover:text-cyan-50 transition-colors pr-2">
              {text}
            </p>
          </div>

            <div className="mr-4">

                {/* Subgroups info - faded on the right */}
                {subgroups ? (
                  <div className="hidden sm:flex items-center  flex-shrink-0">
                    <span className="text-slate-400/60 text-xs font-mono px-2 py-1 rounded-md bg-slate-800/40 border border-slate-600/30">
                      {subgroups}
                    </span>
                  </div>
                ): 
                (
                <div className="hidden sm:flex items-center  flex-shrink-0">
                    <span className="text-slate-400/60 text-xs font-mono px-2 py-1 rounded-md bg-slate-800/40 border border-slate-600/30">
                      None
                    </span>
                  </div>
                  )}

                <span className="m-2 text-slate-400/60 text-xs font-mono px-2 py-1 rounded-md bg-slate-800/40 border border-slate-600/30">
                      {count}
                  </span>
            </div>

          {/* Right side: Buttons */}
          <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onClickIncrease({ text, subgroups, style, count, onClickIncrease, onClickDecrease });
              }}
              className="
                relative overflow-hidden
                w-8 h-8 sm:w-10 sm:h-10
                bg-gradient-to-br from-emerald-500/90 to-emerald-600/90
                text-white font-bold text-sm sm:text-lg
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
              ">
              +
            </button>
            
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onClickDecrease({ text, subgroups, style, count, onClickIncrease, onClickDecrease });
              }}
              className="
                relative overflow-hidden
                w-8 h-8 sm:w-10 sm:h-10
                bg-gradient-to-br from-rose-500/90 to-pink-600/90
                text-white font-bold text-sm sm:text-lg
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
              ">
              −
            </button>
          </div>
        </div>

        {/* Mobile subgroups display */}
        {subgroups && (
          <div className="sm:hidden mt-2 ml-4">
            <span className="text-slate-400/50 text-xs font-mono px-2 py-1 rounded-md bg-slate-800/20 border border-slate-700/30">
              {subgroups}
            </span>
          </div>
        )}
      </div>
    </>
  );
};

export default Container;