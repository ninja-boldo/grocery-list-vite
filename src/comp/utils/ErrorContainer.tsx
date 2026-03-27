interface Props {
  text: string;
}

const ErrorContainer = ({ text }: Props) => {
  return (
    <div className="mb-3">
      <div
        className="
                relative
                bg-gradient-to-r from-slate-900/80 to-slate-800/80
                border border-red-500/40
                rounded-xl shadow-lg shadow-red-500/10
                px-4 py-3
                backdrop-blur-md
                transition-all duration-300
                hover:shadow-red-400/20
                hover:border-red-400/50
            "
      >
        {/* Subtle red accent line */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-gradient-to-b from-red-400 to-red-500 rounded-r-full shadow-sm shadow-red-500/50"></div>

        <p className="ml-3 text-red-200/90 text-sm font-medium">
          <span className="text-red-300/70 font-mono text-xs mr-2">error:</span>
          {text}
        </p>
      </div>
    </div>
  );
};

export default ErrorContainer;
