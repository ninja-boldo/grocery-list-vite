interface Props {
  name: string;
  totalCount: number;
  isOpen: boolean;
  onClick: () => void;
}

const GroupHeader = ({ name, totalCount, isOpen, onClick }: Props) => {
  return (
    <div
      onClick={onClick}
      className={`
        group relative
        flex items-center justify-between cursor-pointer
        bg-linear-to-r from-slate-900/90 to-slate-800/90
        border border-cyan-500/30
        rounded-2xl shadow-lg shadow-cyan-500/10
        p-4 transition-all duration-300 ease-out
        hover:shadow-xl hover:shadow-cyan-400/20
        hover:border-cyan-400/50
        hover:from-slate-800/95 hover:to-slate-700/95
        hover:scale-[1.02] hover:-translate-y-1
        w-full
        backdrop-blur-md
        ${isOpen ? 'shadow-xl shadow-cyan-400/25 border-cyan-400/60 scale-[1.02] -translate-y-1' : ''}
      `}
    >
      {/* Animated background pulse */}
      <div className={`absolute inset-0 rounded-2xl bg-linear-to-r from-cyan-500/5 to-blue-500/5 transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}></div>
      
      {/* Neon accent glow */}
      <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-linear-to-b from-cyan-400 via-cyan-500 to-blue-500 rounded-r-full shadow-lg shadow-cyan-500/50 group-hover:shadow-cyan-400/70 transition-all duration-300 ${isOpen ? 'h-12 shadow-cyan-400/80' : 'h-8'}`}></div>

      {/* Animated corner accent */}
      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-cyan-400/60 shadow-sm shadow-cyan-400/50 transition-all duration-300 group-hover:bg-cyan-400/80 group-hover:shadow-cyan-400/70"></div>

      {/* Main content */}
      <div className="flex items-center justify-between w-full ml-4 relative z-10">
        {/* Group name */}
        <div className="flex-1 min-w-0 mr-4">
          <p className="text-cyan-100 font-medium text-base truncate group-hover:text-cyan-50 transition-colors duration-300">
            {name}
          </p>
        </div>

        {/* Total count */}
        <div className="flex items-center gap-3 mr-2">
          <span className="text-cyan-100 text-sm font-bold font-mono px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-600/40 backdrop-blur-sm transition-all duration-300 group-hover:bg-slate-700/70 group-hover:border-slate-500/50 group-hover:text-cyan-50">
            {totalCount}x
          </span>
        </div>

        {/* Dropdown arrow */}
        <div className="ml-2 shrink-0">
          <div className={`w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-cyan-400/70 transition-all duration-300 ${isOpen ? 'rotate-180 border-t-cyan-300' : ''}`}></div>
        </div>
      </div>
    </div>
  );
};

export default GroupHeader;
