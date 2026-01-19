interface Props {
  tag: string;
  index: number;
  isOpen: boolean;
}

const TagBadge = ({ tag, index, isOpen }: Props) => {
  return (
    <div
      className={`
        px-3 py-1.5 rounded-lg text-sm font-medium
        bg-emerald-600/80 text-emerald-50
        border border-emerald-500/40
        shadow-sm shadow-emerald-500/20
        hover:bg-emerald-500/90 hover:border-emerald-400/60
        transition-all duration-300
        ${isOpen ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}
      `}
      style={{ transitionDelay: `${Math.min(index * 50, 200)}ms` }}
    >
      {tag}
    </div>
  );
};

export default TagBadge;
