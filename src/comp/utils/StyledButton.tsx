interface Props {
    text: string;
    onClick: (triggerNull: null) => void;
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    disabled?: boolean;
    loading?: boolean;
}

const StyledButton = ({ 
    text, 
    onClick, 
    disabled = false,
    loading = false
}: Props) => {

    return (
        <button 
            className="object-contain"
            onClick={() => onClick(null)}
            disabled={disabled || loading}
        >
        {text}    
        </button>
    );
};

export default StyledButton;