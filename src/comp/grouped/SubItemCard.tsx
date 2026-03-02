interface Props {
  name: string;
  count: number;
  index: number;
  isOpen: boolean;
}

const SubItemCard = ({ name, count, index, isOpen }: Props) => {
  return (
    <div
      className={`
        group/item relative
        flex items-center justify-between
        
        bg-linear-to-r from-emerald-600/70 to-emerald-700/70
        border border-emerald-500/40
        rounded-xl shadow-md shadow-emerald-500/20
        p-3.5 transition-all duration-300 ease-out
        hover:shadow-lg hover:shadow-emerald-400/30
        hover:border-emerald-400/60
        hover:from-emerald-500/80 hover:to-emerald-600/80
        hover:scale-[1.02]
        backdrop-blur-sm
        ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}
      `}
      style={{ transitionDelay: `${Math.min(index * 60, 300)}ms` }}
    >
      {/* Neon accent */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-linear-to-b from-emerald-400 to-emerald-500 rounded-r-full shadow-sm shadow-emerald-400/50 transition-all duration-300 group-hover/item:h-8"></div>

      {/* Item name */}
      <div className="flex-1 min-w-0 ml-3">
        <p className="text-emerald-50 font-medium text-sm truncate group-hover/item:text-white transition-colors duration-300">
          {name}
        </p>
      </div>

      {/* Count badge */}
      <div className="ml-3 shrink-0">
        <span className="
          inline-flex items-center justify-center
          min-w-12 px-2.5 py-1
          text-emerald-100 text-sm font-bold font-mono
          bg-emerald-800/60 rounded-lg
          border border-emerald-600/50
          shadow-sm
          group-hover/item:bg-emerald-700/70 group-hover/item:border-emerald-500/60
          transition-all duration-300
        ">
          {count}x
        </span>
      </div>
    </div>
  );
};

export default SubItemCard;
