import { useEffect, useRef, useState } from "react";

interface Props {
  text: string | null;
  subgroups: string | null;
  style?: string;
  count: number;
  classname: string | null;
  perish_dates: string[] | null;
  imageUrl: string;
  ean: string;
  onClickIncrease: (clickedNode: Props) => Promise<void>;
  onClickDecrease: (clickedNode: Props) => Promise<void>;
}

const Container = ({
  text,
  subgroups,
  style,
  count,
  classname,
  perish_dates,
  imageUrl,
  ean,
  onClickIncrease,
  onClickDecrease,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [isIncreasing, setIsIncreasing] = useState(false);
  const [isDecreasing, setIsDecreasing] = useState(false);
  const divRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const parseArr = (value: string | string[] | null): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    // value is string
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // if string looks like items separated by commas without JSON, try a fallback:
      const trimmed = value.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) return [];
      return trimmed
        .replace(/^$$|$$$/g, "")        // strip surrounding brackets
        .split(",")
        .map(s => s.trim().replace(/^"|"$/g, "")) // trim and strip quotes
        .filter(Boolean);
    }
  };

  //  detect outside clicks and close if not on the main div
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (divRef.current && !divRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, []);

  const perish_dates_arr = parseArr(perish_dates);

  const handleIncreaseClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsIncreasing(true);
    try {
      await onClickIncrease({
        text,
        subgroups,
        style,
        count,
        classname,
        perish_dates,
        imageUrl,
        onClickIncrease,
        onClickDecrease,
        ean,
      });
    } finally {
      setTimeout(() => setIsIncreasing(false), 300);
    }
  };

  const handleDecreaseClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDecreasing(true);
    try {
      await onClickDecrease({
        text,
        subgroups,
        style,
        count,
        classname,
        perish_dates,
        imageUrl,
        onClickIncrease,
        onClickDecrease,
        ean,
      });
    } finally {
      setTimeout(() => setIsDecreasing(false), 300);
    }
  };

  return (
    <div className="mb-4 px-4">
      <div
        ref={divRef}
        onClick={() => setOpen(!open)}
        className={`
          group relative
          flex items-center cursor-pointer
          bg-linear-to-r from-slate-900/90 to-slate-800/90
          border border-cyan-500/30
          rounded-2xl shadow-lg shadow-cyan-500/10
          p-4 transition-all duration-300 ease-out
          hover:shadow-xl hover:shadow-cyan-400/20
          hover:border-cyan-400/50
          hover:from-slate-800/95 hover:to-slate-700/95
          hover:scale-[1.02] hover:-translate-y-1
          w-full mt-2
          backdrop-blur-md
          ${open ? 'shadow-xl shadow-cyan-400/25 border-cyan-400/60 scale-[1.02] -translate-y-1' : ''}
          ${style || ""}
        `}
      >
        {/* Animated background pulse */}
        <div className={`absolute inset-0 rounded-2xl bg-linear-to-r from-cyan-500/5 to-blue-500/5 transition-opacity duration-500 ${open ? 'opacity-100' : 'opacity-0'}`}></div>
        
        {/* Neon accent glow with enhanced animation */}
        <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-linear-to-b from-cyan-400 via-cyan-500 to-blue-500 rounded-r-full shadow-lg shadow-cyan-500/50 group-hover:shadow-cyan-400/70 transition-all duration-300 ${open ? 'h-12 shadow-cyan-400/80' : 'h-8'}`}></div>

        {/* Animated corner accent */}
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-cyan-400/60 shadow-sm shadow-cyan-400/50 transition-all duration-300 group-hover:bg-cyan-400/80 group-hover:shadow-cyan-400/70"></div>

        {/* Main content area */}
        <div className="flex items-center justify-between w-full ml-4 relative z-10">
          {/* Left side - Item name with enhanced typography */}
          <div className="flex-1 min-w-0 mr-4">
            <p className="text-cyan-100 font-medium text-base truncate group-hover:text-cyan-50 transition-colors duration-300 relative">
              {classname && classname !== "none" ? classname : text}
              {/* Subtle text glow effect */}
              <span className="absolute inset-0 text-cyan-400/20 blur-sm transition-opacity duration-300 group-hover:opacity-100 opacity-0">{classname && classname !== "none"}</span>
            </p>
          </div>

          {/* Middle section - Count, Subgroups with improved styling */}
          <div className="flex items-center gap-3">
            {/* Subgroups + count (desktop) */}
            <div className="hidden sm:flex flex-col gap-1">
              <span className="text-slate-300/70 text-xs font-mono px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-600/40 whitespace-nowrap backdrop-blur-sm transition-all duration-300 group-hover:bg-slate-700/70 group-hover:border-slate-500/50 group-hover:text-slate-200/80">
                {subgroups || "None"}
              </span>
              <span className="text-slate-300/70 text-xs font-mono px-2 py-1 rounded-lg bg-slate-800/60 border border-slate-600/40 whitespace-nowrap backdrop-blur-sm transition-all duration-300 group-hover:bg-slate-700/70 group-hover:border-slate-500/50 group-hover:text-slate-200/80">
                <span className={`transition-all duration-300 ${isIncreasing ? 'text-emerald-400 scale-110' : isDecreasing ? 'text-rose-400 scale-90' : ''}`}>
                  {count}x
                </span>
              </span>
            </div>

            {/* Mobile - inline */}
            <div className="flex sm:hidden flex-col gap-1">
              <span className="text-slate-300/70 text-xs font-mono px-1 py-1 rounded-lg bg-slate-800/60 border border-slate-600/40 max-w-16 truncate backdrop-blur-sm transition-all duration-300 group-hover:bg-slate-700/70 group-hover:border-slate-500/50">
                {subgroups || "None"}
              </span>
              <span className="text-slate-300/70 text-xs font-mono px-1 py-1 rounded-lg bg-slate-800/60 border border-slate-600/40 max-w-16 truncate backdrop-blur-sm transition-all duration-300 group-hover:bg-slate-700/70 group-hover:border-slate-500/50">
                <span className={`transition-all duration-300 ${isIncreasing ? 'text-emerald-400 scale-110' : isDecreasing ? 'text-rose-400 scale-90' : ''}`}>
                  {count}x
                </span>
              </span>
            </div>
          </div>

          {/* Right side - Enhanced Buttons */}
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={handleIncreaseClick}
              disabled={isIncreasing}
              className={`
                relative overflow-hidden
                w-10 h-10
                bg-linear-to-br from-emerald-500/90 to-emerald-600/90
                text-white font-bold text-lg
                rounded-xl shadow-lg shadow-emerald-500/25
                hover:from-emerald-400/95 hover:to-emerald-500/95
                hover:shadow-xl hover:shadow-emerald-400/40 
                hover:scale-105
                active:scale-95
                disabled:scale-100 disabled:animate-pulse
                transition-all duration-200
                flex justify-center items-center
                border border-emerald-400/40 hover:border-emerald-300/60
                before:absolute before:inset-0 before:bg-white/10 before:-translate-x-full 
                hover:before:translate-x-full before:transition-transform before:duration-500
                shrink-0
                ${isIncreasing ? 'scale-110 from-emerald-400 to-emerald-500 shadow-emerald-400/60' : ''}
              `}
            >
              <span className={`transition-transform duration-200 ${isIncreasing ? 'scale-125' : ''}`}>+</span>
            </button>

            <button
              onClick={handleDecreaseClick}
              disabled={isDecreasing}
              className={`
                relative overflow-hidden
                w-10 h-10
                bg-linear-to-br from-rose-500/90 to-pink-600/90
                text-white font-bold text-lg
                rounded-xl shadow-lg shadow-rose-500/25
                hover:from-rose-400/95 hover:to-pink-500/95
                hover:shadow-xl hover:shadow-rose-400/40 
                hover:scale-105
                active:scale-95
                disabled:scale-100 disabled:animate-pulse
                transition-all duration-200
                flex justify-center items-center
                border border-rose-400/40 hover:border-rose-300/60
                before:absolute before:inset-0 before:bg-white/10 before:-translate-x-full 
                hover:before:translate-x-full before:transition-transform before:duration-500
                shrink-0
                ${isDecreasing ? 'scale-110 from-rose-400 to-pink-500 shadow-rose-400/60' : ''}
              `}
            >
              <span className={`transition-transform duration-200 ${isDecreasing ? 'scale-125' : ''}`}>−</span>
            </button>
          </div>

          {/* Enhanced dropdown arrow indicator */}
          <div className="ml-2 shrink-0">
            <div className={`w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-cyan-400/70 transition-all duration-300 ${open ? 'rotate-180 border-t-cyan-300' : ''}`}></div>
          </div>
        </div>
      </div>

      {/* Enhanced Dropdown content with smooth animations and proper overflow */}
      <div 
        ref={dropdownRef}
        className={`transition-all duration-500 ease-out ${open && perish_dates_arr[0] !== "none" ? 'max-h-125 opacity-100' : 'max-h-0 opacity-0'}`}
        style={{ overflow: 'hidden' }}
      >
        <div className={`mt-2 transform transition-all duration-400 ${open ? 'translate-y-0' : '-translate-y-4'}`}>
          {perish_dates_arr && perish_dates_arr.length > 0 ? (
            <div className="bg-linear-to-r from-slate-900/80 to-slate-800/80 backdrop-blur-md rounded-xl border border-cyan-500/20 shadow-lg shadow-cyan-500/10 mx-2">
              {/* Header */}
              <div className="flex items-start gap-3 p-3 border-b border-slate-700/50">
                {/* Image */}
                <img
                  src={imageUrl}
                  loading="lazy"
                  alt={`couldnt display image of the product ${text}`}
                  className="w-20 h-20 object-contain rounded-lg bg-slate-800/30 p-1 border border-slate-700/40 shrink-0"
                />
                
                {/* Content */}
                <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                  {/* Product name */}

                  <div className="flex flex-col items-center gap-1.5">
                    <h3 className="text-slate-100 text-base font-semibold leading-tight wrap-break-word">
                      {text}
                    </h3>
                    <span className="text-xs text-slate-400 font-mono opacity-80">
                      (ean: { ["", "0", "-1", "1"].includes(ean) ? "none" : ean})
                    </span>
                  </div>

                  {/* Added timestamp info row - clearly grouped */}
                  <div className="flex items-center gap-2 bg-cyan-500/10 rounded-lg px-2.5 py-1.5 border border-cyan-500/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/80 shadow-sm shadow-cyan-400/50 shrink-0"></div>
                    <span className="text-cyan-300 text-sm font-medium">Dates added</span>
                    <span className="text-cyan-200/70 text-xs font-mono">
                      ({perish_dates_arr.length} item{perish_dates_arr.length !== 1 ? 's' : ''})
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Scrollable content area */}
              <div className="max-h-64 overflow-y-auto overflow-x-hidden p-2 space-y-1">
                {perish_dates_arr.map((date, i) => (
                  <div 
                    key={i} 
                    className={`
                      flex items-center gap-3 p-2 rounded-lg 
                      bg-slate-800/40 border border-slate-700/30
                      hover:bg-slate-700/50 hover:border-slate-600/40 
                      transition-all duration-300 transform
                      ${open ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}
                    `}
                    style={{ transitionDelay: `${Math.min(i * 50, 300)}ms` }}
                  >
                    <div className="w-1 h-1 rounded-full bg-cyan-400/60 shrink-0"></div>
                    <p className="text-slate-200/90 text-sm font-mono flex-1">{date}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-linear-to-r from-slate-900/80 to-slate-800/80 backdrop-blur-md rounded-xl border border-red-500/20 shadow-lg shadow-red-500/10 mx-2 p-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400/80 shadow-sm shadow-red-400/50"></div>
                <p className="text-red-300/90 text-sm font-medium">Error: Code 42 - No valid dates found</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Container;