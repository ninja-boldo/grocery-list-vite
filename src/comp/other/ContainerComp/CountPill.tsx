import { memo } from "react";

interface Props {
    instockNumber: number;
    wishedNumber: number | null;
    isIncreasing: boolean;
    isDecreasing: boolean;
    TEAL: string;
    TEAL_B: string;
    TEAL_D: string;
}

const CountPill = ({ instockNumber, wishedNumber, isIncreasing, isDecreasing, TEAL, TEAL_B, TEAL_D }: Props) => {
    const isSuboptimal = wishedNumber !== null && wishedNumber > instockNumber;

    const bgColor = isIncreasing
        ? "#0d4a3f"
        : isDecreasing
            ? "#4a1020"
            : isSuboptimal
                ? "#1f1515"  
                : TEAL_D;

    const textColor = isIncreasing
        ? "#2dd4bf"
        : isDecreasing
            ? "#f87171"
            : isSuboptimal
                ? "#e2a0a0"  
                : "#5eead4";

    const borderColor = isIncreasing
        ? TEAL
        : isDecreasing
            ? "#ef444450"
            : isSuboptimal
                ? "#f8717120"  
                : TEAL_B;
    const scale = isIncreasing
        ? "scale(1.08)"
        : isDecreasing
            ? "scale(0.94)"
            : "scale(1)";

    const pillStyle: React.CSSProperties = {
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        padding: "0 10px",
        height: 24,
        minWidth: 36,
        fontVariantNumeric: "tabular-nums",
        transition: "all 0.18s",
        backgroundColor: bgColor,
        color: textColor,
        border: `1px solid ${borderColor}`,
        transform: scale,
    };

    return (
        <span style={pillStyle}>
            {wishedNumber ? `${instockNumber} / ${wishedNumber}` : `${instockNumber}x`}
        </span>
    );
};

export default memo(CountPill);