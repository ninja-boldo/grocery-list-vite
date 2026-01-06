import { PlusIcon, MinusIcon } from '@heroicons/react/24/outline';

interface Props {
    onClickUpper: () => void;
    onClickBottom: () => void;
    disabled?: boolean;
}

const SplitButton = ({ onClickUpper, onClickBottom, disabled = false }: Props) => {
    const btnClass = "flex items-center justify-center h-8.5 px-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 transition-colors";
    
    return (
        <div className="flex flex-col gap-px h-[70px] rounded-lg overflow-hidden border border-slate-600 bg-slate-600">
            <button 
                className={btnClass}
                onClick={onClickUpper}
                disabled={disabled}
            >
                <PlusIcon className="h-5 w-4 text-white" />
            </button>
            <button 
                className={btnClass}
                onClick={onClickBottom}
                disabled={disabled}
            >
                <MinusIcon className="h-5 w-4 text-white" />
            </button>
        </div>
    );
};

export default SplitButton;