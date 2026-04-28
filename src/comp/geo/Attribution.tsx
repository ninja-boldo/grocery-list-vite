import { memo, useState } from "react";
import { Info, X } from "lucide-react";
import "../../styles/geo.css";
import { useTranslation } from "react-i18next";

const Attribution = () => {
  const { t } = useTranslation();
  const [opened, setOpened] = useState<boolean>(false);

  return (
    <div className="attribution-container">
      {opened ? (
        <div className="attribution-panel">
          <button
            className="attribution-close"
            onClick={() => setOpened(false)}
            aria-label={t("closeAttribution", "Close attribution")}
          >
            <X size={14} />
          </button>
          <p>
            {t("mapData", "Map data ©")}{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("openstreetmap", "OpenStreetMap")}
            </a>{" "}
            {t("contributorsLicensedUnder", "contributors, licensed under")}{" "}
            <a
              href="https://opendatacommons.org/licenses/odbl/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("odbl", "ODbL")}
            </a>
          </p>
        </div>
      ) : (
        <button
          className="attribution-toggle"
          onClick={() => setOpened(true)}
          aria-label={t("showAttributionInfo", "Show attribution info")}
        >
          <Info size={16} />
        </button>
      )}
    </div>
  );
};

export default memo(Attribution);
