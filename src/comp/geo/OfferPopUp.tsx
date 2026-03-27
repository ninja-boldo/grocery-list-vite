import type { OfferCardProps } from "./OfferCard";
import OfferCard from "./OfferCard";

type Props = {
  offers: OfferCardProps[];
  emptyMessage?: string;
};

export const OfferPopup = ({ offers, emptyMessage }: Props) => {
  if (offers.length === 0) {
    return <div>{emptyMessage ?? "No offers found."}</div>;
  }

  return (
    <div style={{ flex: 1, flexDirection: "column" }}>
      {offers.map((offer, idx) => (
        <OfferCard
          key={idx}
          name={offer.name}
          shortened_name={offer.shortened_name}
          weight_g={offer.weight_g}
          volume_ml={offer.volume_ml}
          normal_price={offer.normal_price}
          discount_price={offer.discount_price}
          discount_rate={offer.discount_rate}
          is_app_offer={offer.is_app_offer}
        />
      ))}
    </div>
  );
};
