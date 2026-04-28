import OfferCard, { type OfferCardProps } from "./OfferCard";
import { useTranslation } from "react-i18next";

type OfferListProps = {
  offers: OfferCardProps[];
  className?: string;
  emptyMessage?: string;
};

const OfferList = ({ offers, className, emptyMessage }: OfferListProps) => {
  const { t } = useTranslation();
  if (!offers.length) {
    return (
      <section
        className={[
          "relative overflow-hidden rounded-2xl border border-[#7dcfbd3d]",
          "bg-[#11211fd9]",
          "p-6 text-center my-2 shadow-[0_8px_26px_rgba(0,0,0,0.22)]",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          style={{
            pointerEvents: "none",
            position: "absolute",
            top: -40,
            left: "50%",
            transform: "translateX(-50%)",
            width: 96,
            height: 96,
            borderRadius: "50%",
            background: "var(--accent-glow)",
            filter: "blur(24px)",
          }}
        />
        <p
          style={{
            position: "relative",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            fontWeight: 600,
            color: "var(--text-dim)",
          }}
        >
          {t("angebotsvorschau", "Angebotsvorschau")}
        </p>
        <p
          style={{
            position: "relative",
            marginTop: 8,
            fontSize: 14,
            color: "var(--accent-text)",
          }}
        >
          {emptyMessage}
        </p>
      </section>
    );
  }

  return (
    <section
      className={["my-1.5 space-y-2.5 sm:space-y-3", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={t("angebotsliste", "Angebotsliste")}
    >
      <div className="card-grid">
        {offers.map((offer, index) => (
          <div
            key={`${offer.name}-${offer.shortened_name}-${offer.normal_price}-${offer.discount_price}-${index}`}
            style={{ margin: "0 2px" }}
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <OfferCard {...offer} />
          </div>
        ))}
      </div>
    </section>
  );
};

export type { OfferListProps };
export default OfferList;
