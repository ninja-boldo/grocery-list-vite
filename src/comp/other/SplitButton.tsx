import { PlusIcon, MinusIcon } from '@heroicons/react/24/outline';

interface Props {
    onClickUpper: () => void;
    onClickBottom: () => void;
    disabled?: boolean;
}

const SplitButton = ({ onClickUpper, onClickBottom, disabled = false }: Props) => {
    return (
        <div className="inline-flex h-11 p-1 bg-slate-700/70 backdrop-blur-md rounded-full border-2 border-slate-500/60 shadow-xl">
            <button 
                className="flex items-center justify-center w-14 h-full rounded-full hover:bg-slate-600/80 active:bg-slate-500/90 disabled:opacity-50 transition-all duration-150 group"
                onClick={onClickBottom}
                disabled={disabled}
                aria-label="Decrease"
            >
                <MinusIcon className="h-3 w-3 text-white group-hover:scale-110 stroke-[3] transition-transform" />
            </button>
            
            <div className="w-[1.5px] bg-gradient-to-b from-transparent via-slate-400/60 to-transparent my-2" />
            
            <button 
                className="flex items-center justify-center w-14 h-full rounded-full hover:bg-slate-600/80 active:bg-slate-500/90 disabled:opacity-50 transition-all duration-150 group"
                onClick={onClickUpper}
                disabled={disabled}
                aria-label="Increase"
            >
                <PlusIcon className="h-3 w-3 text-white group-hover:scale-110 stroke-[3] transition-transform" />
            </button>
        </div>
    );
};

export default SplitButton;