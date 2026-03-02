import { memo } from "react";

export const BadgeType = {
  DateBadge: "date_badge",
  TextBadge: "text_badge",
} as const;

export type BadgeType = typeof BadgeType[keyof typeof BadgeType];


interface Props{
    text_or_dates: string | string[],
    type: BadgeType | null,
    Color_1: string | undefined,
    Color_2: string | undefined
}


const Badge = ({
  text_or_dates,
  type,
  Color_1 = "#5eead4",
  Color_2 = "#0f2a28"
}: Props) => {

  const isTextBadge = !type || type === BadgeType.TextBadge
  const isDateBadge = type === BadgeType.DateBadge

  if (isTextBadge && Array.isArray(text_or_dates)) {
    console.error("TextBadge cannot receive an array")
    throw "TextBadge cannot receive an array"
  }

  if (isDateBadge && typeof text_or_dates === "string") {
    text_or_dates = [text_or_dates]
  }

  const text = isTextBadge ? text_or_dates as string : null
  const dates = isDateBadge ? text_or_dates as string[] : []

  return isTextBadge ? (
    <div
      style={{
        background: Color_2,
        fontSize: 11,
        border: `1px solid #0d948850`,
        color: Color_1,
        padding: "3px 10px",
        marginInline: "0.6em",
        borderRadius: 999,
        margin: "0.4em",
      }}
    >
      {text}
    </div>
  ) : (
    <div>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          alignSelf: "flex-start",
          fontSize: 11,
          fontWeight: 600,
          color: Color_1,
          backgroundColor: Color_2,
          border: `1px solid ${Color_1}50`,
          borderRadius: 999,
          padding: "3px 10px",
          margin: "0.4em",
          marginInline: "0.6em",

        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          {/* calendar sign */}
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {dates.length} date{dates.length !== 1 ? "s" : ""}
      </span>
    </div>
  )
}

export default memo(Badge);