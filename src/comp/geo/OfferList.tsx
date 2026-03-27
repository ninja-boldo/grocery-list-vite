import OfferCard, { type OfferCardProps } from "./OfferCard";

type OfferListProps = {
  offers: OfferCardProps[];
  className?: string;
  emptyMessage?: string;
};

const OfferList = ({
  offers,
  className,
  emptyMessage = "Keine Angebote gefunden.",
}: OfferListProps) => {
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
        <div className="pointer-events-none absolute -top-10 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full bg-[#48d7c533] blur-2xl" />
        <p className="relative text-[11px] uppercase tracking-[0.16em] font-semibold text-[#8ec9bf]">
          Angebotsvorschau
        </p>
        <p className="relative mt-2 text-sm text-[#c6ebe3]">{emptyMessage}</p>
      </section>
    );
  }

  return (
    <section
      className={["my-1.5 space-y-2.5 sm:space-y-3", className]
        .filter(Boolean)
        .join(" ")}
      aria-label="Angebotsliste"
    >
      <div className="grid grid-cols-1 gap-2.5 sm:gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {offers.map((offer, index) => (
          <div
            key={`${offer.name}-${offer.shortened_name}-${offer.normal_price}-${offer.discount_price}-${index}`}
            className="mx-0.5 transform-gpu"
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
