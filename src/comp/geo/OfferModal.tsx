import type { OfferCardProps } from "./OfferCard";
import OfferList from "./OfferList";
import { useTranslation } from "react-i18next";

type OfferModalProps = {
  isOpen: boolean;
  onClose: () => void;
  offers: OfferCardProps[];
  isLoading: boolean;
  error: string | null;
  title?: string;
};

const OfferModal = ({
  isOpen,
  onClose,
  offers,
  isLoading,
  error,
  title,
}: OfferModalProps) => {
  const { t } = useTranslation();
  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="geo-offer-modal__overlay" onClick={onClose} />

      <section
        className="geo-offer-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("Offers", "Offers")}
      >
        <header className="geo-offer-modal__header">
          <div>
            <p className="geo-offer-modal__eyebrow">
              {t("nearbyDeals", "Nearby Deals")}
            </p>
            <h3 className="geo-offer-modal__title">{title ?? "Offers"}</h3>
          </div>
          <button
            type="button"
            className="geo-offer-modal__close"
            onClick={onClose}
            aria-label={t("closeOffers", "Close offers")}
          >
            x
          </button>
        </header>

        <div className="geo-offer-modal__body">
          {isLoading ? (
            <div className="geo-offer-modal__state">
              {t("loadingOffers", "Loading offers...")}
            </div>
          ) : error ? (
            <div className="geo-offer-modal__state geo-offer-modal__state--error">
              {error}
            </div>
          ) : (
            <OfferList
              offers={offers}
              className="geo-offer-modal__list"
              emptyMessage="No offers found for this location."
            />
          )}
        </div>
      </section>
    </>
  );
};

export default OfferModal;
