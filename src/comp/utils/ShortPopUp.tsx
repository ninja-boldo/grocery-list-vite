import { useTranslation } from "react-i18next";

interface Props {
  text: string;
  variant: "error" | "success";
}

const ShortPopup = ({ text, variant }: Props) => {
  const { t } = useTranslation();
  const isError = variant === "error";
  return (
    <div className="short-popup">
      <div className={`short-popup__inner short-popup__inner--${variant}`}>
        <div className={`short-popup__dot short-popup__dot--${variant}`} />
        <div>
          <p className={`short-popup__text short-popup__text--${variant}`}>
            {text}
          </p>
          <p className="short-popup__sub">
            {isError
              ? t("somethingWentWrong", "Something went wrong")
              : t("addedSuccessfully", "✓ Added successfully!")}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ShortPopup;
