interface Props {
  text: string;
  variant: "error" | "success";
}

const styles = {
  error: {
    bg: "bg-rose-50/90 dark:bg-rose-950/40",
    border: "border-rose-200/60 dark:border-rose-500/30",
    text: "text-rose-900 dark:text-rose-100",
    sub: "text-rose-700/80 dark:text-rose-300/70",
    dot: "bg-rose-500",
  },
  success: {
    bg: "bg-green-50/90 dark:bg-green-950/40",
    border: "border-green-200/60 dark:border-green-500/30",
    text: "text-green-900 dark:text-green-100",
    sub: "text-green-700/80 dark:text-green-300/70",
    dot: "bg-green-500",
  },
};

const ShortPopup = ({ text, variant }: Props) => {
  const s = styles[variant];

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div
        className={`
          ${s.bg} ${s.border}
          backdrop-blur-md border
          rounded-2xl px-5 py-3.5
          min-w-[280px]
          shadow-lg flex items-start gap-3
        `}
      >
        <div className={`w-2 h-2 mt-1.5 rounded-full ${s.dot}`} />
        <div className="flex flex-col">
          <p className={`${s.text} text-sm font-semibold`}>{text}</p>
          <p className={`${s.sub} text-xs font-medium`}>
            {variant === "error" ? "Something went wrong" : "Success"}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ShortPopup;
