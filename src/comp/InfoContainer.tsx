
interface Props{
    text: string
}

const InfoContainer = ( {text}: Props ) => {

    return(
        <div className="mb-3">
            <div className="
                relative
                bg-gradient-to-r from-slate-900/80 to-slate-800/80
                border border-emerald-500/40
                rounded-xl shadow-lg shadow-emerald-500/10
                px-4 py-3
                backdrop-blur-md
                transition-all duration-300
                hover:shadow-emerald-400/20
                hover:border-emerald-400/50
            ">
                {/* Subtle emerald accent line */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-gradient-to-b from-emerald-400 to-emerald-500 rounded-r-full shadow-sm shadow-emerald-500/50"></div>
                
                <p className="ml-3 text-emerald-200/90 text-sm font-medium whitespace-pre-line">
                    <span className="text-emerald-300/70 font-mono text-xs mr-2">info:</span>
                    {text}
                </p>
            </div>
        </div>
    )
}

export default InfoContainer