interface Props {
    text: string;
    onClick: (triggerNull: null) => void;
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    disabled?: boolean;
    loading?: boolean;
}

const StyledButton = ({ 
    text, 
    onClick, 
    className,
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false
}: Props) => {
    const baseClasses = `
        relative inline-flex items-center justify-center
        font-semibold rounded-xl
        transition-all duration-300 ease-out
        transform active:scale-95
        focus:outline-none focus:ring-4 focus:ring-opacity-50
        disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
        shadow-lg hover:shadow-xl
        backdrop-blur-sm
    `.replace(/\s+/g, ' ').trim();
    
    const sizeClasses = {
        sm: "px-4 py-2 text-sm min-h-[36px] gap-2",
        md: "px-6 py-3 text-sm min-h-[44px] gap-2",
        lg: "px-8 py-4 text-base min-h-[52px] gap-3",
        xl: "px-10 py-5 text-lg min-h-[60px] gap-3"
    };
    
    const variantClasses = {
        primary: `
            bg-gradient-to-r from-blue-600 to-purple-600 
            hover:from-blue-700 hover:to-purple-700
            active:from-blue-800 active:to-purple-800
            text-white shadow-blue-500/25
            focus:ring-blue-500
            border border-blue-500/20
        `,
        secondary: `
            bg-gradient-to-r from-gray-700 to-gray-800 
            hover:from-gray-600 hover:to-gray-700
            active:from-gray-800 active:to-gray-900
            text-gray-100 shadow-gray-500/25
            focus:ring-gray-500
            border border-gray-600/30
        `,
        outline: `
            bg-transparent hover:bg-white/5 active:bg-white/10
            border-2 border-gray-300 hover:border-white
            text-gray-300 hover:text-white
            shadow-gray-500/10
            focus:ring-gray-400
            backdrop-blur-md
        `,
        ghost: `
            bg-white/5 hover:bg-white/10 active:bg-white/15
            text-gray-300 hover:text-white
            shadow-none hover:shadow-md shadow-gray-500/20
            focus:ring-gray-400
            border border-white/10 hover:border-white/20
        `,
        danger: `
            bg-gradient-to-r from-red-600 to-rose-600 
            hover:from-red-700 hover:to-rose-700
            active:from-red-800 active:to-rose-800
            text-white shadow-red-500/25
            focus:ring-red-500
            border border-red-500/20
        `
    };
    
    const classes = `
        ${baseClasses} 
        ${sizeClasses[size]} 
        ${variantClasses[variant].replace(/\s+/g, ' ').trim()}
    `.replace(/\s+/g, ' ').trim();
    
    return (
        <button 
            className={`${classes} ${className || ""}`}
            onClick={() => onClick(null)}
            disabled={disabled || loading}
        >
            {loading && (
                <svg 
                    className="animate-spin -ml-1 mr-2 h-4 w-4" 
                    xmlns="http://www.w3.org/2000/svg" 
                    fill="none" 
                    viewBox="0 0 24 24"
                >
                    <circle 
                        className="opacity-25" 
                        cx="12" 
                        cy="12" 
                        r="10" 
                        stroke="currentColor" 
                        strokeWidth="4"
                    />
                    <path 
                        className="opacity-75" 
                        fill="currentColor" 
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                </svg>
            )}
            <span className={loading ? "opacity-75" : ""}>{text}</span>
            
            {/* Shimmer effect overlay */}
            <div className="absolute inset-0 -top-px overflow-hidden rounded-xl">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
        </button>
    );
};

export default StyledButton;