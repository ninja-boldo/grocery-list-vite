interface Props {
    text: string;
    onClick: (triggerNull: null) => void;
    variant?: 'primary' | 'secondary' | 'outline';
    style: string | null;
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
}

const StyledButton = ({ 
    text, 
    onClick, 
    style,
    variant = 'primary',
    size = 'md',
    disabled = false 
}: Props) => {
    const baseClasses = "font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed";
    
    const sizeClasses = {
        sm: "px-3 py-1.5 text-sm",
        md: "px-4 py-2 text-sm",
        lg: "px-6 py-3 text-base"
    };
    
    const variantClasses = {
        primary: "bg-slate-600 hover:bg-slate-500 text-white focus:ring-slate-500",
        secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200 focus:ring-slate-400",
        outline: "border border-slate-500 hover:border-slate-400 text-slate-300 hover:text-slate-200 hover:bg-slate-800 focus:ring-slate-400"
    };
    
    const classes = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]}`;
    
    return (
        <button 
            className={`${classes} ${style ? style : ""}`} 
            onClick={() => onClick(null)}
            disabled={disabled}
        >
            {text}
        </button>
    );
};

export default StyledButton;