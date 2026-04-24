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

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

const lerp = (start: number, end: number, t: number) =>
    start + (end - start) * t;

const CountPill = ({ instockNumber, wishedNumber, isIncreasing, isDecreasing, TEAL, TEAL_B, TEAL_D }: Props) => {
    const hasWishTarget = wishedNumber !== null;
    const hasPositiveWishTarget = hasWishTarget && wishedNumber > 0;

    // Missing ratio in [0,1]: 0 means fully covered (or over-covered), 1 means nothing covered.
    const missingRatio = hasPositiveWishTarget
        ? clamp((wishedNumber - instockNumber) / wishedNumber, 0, 1)
        : 0;

    const hasNoMappedPantryItems = hasPositiveWishTarget && instockNumber === 0;

    // Teal -> warning-red severity gradient as the missing percentage rises.
    const gradientHue = lerp(168, 4, missingRatio);

    const ratioBgColor = hasNoMappedPantryItems
        ? "hsl(186, 46%, 14%)"
        : `hsla(${gradientHue}, 64%, 14%, 1)`;

    const ratioTextColor = hasNoMappedPantryItems
        ? "hsl(182, 86%, 73%)"
        : `hsl(${gradientHue}, 78%, 72%)`;

    const ratioBorderColor = hasNoMappedPantryItems
        ? "hsla(184, 72%, 44%, 0.45)"
        : `hsla(${gradientHue}, 62%, 44%, 0.45)`;

    const bgColor = isIncreasing
        ? "#0d4a3f"
        : isDecreasing
            ? "#4a1020"
            : hasWishTarget
                ? ratioBgColor
                : TEAL_D;

    const textColor = isIncreasing
        ? "#2dd4bf"
        : isDecreasing
            ? "#f87171"
            : hasWishTarget
                ? ratioTextColor
                : "#5eead4";

    const borderColor = isIncreasing
        ? TEAL
        : isDecreasing
            ? "#ef444450"
            : hasWishTarget
                ? ratioBorderColor
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
            {wishedNumber !== null ? `${instockNumber} / ${wishedNumber}` : `${instockNumber}x`}
        </span>
    );
};

export default memo(CountPill);