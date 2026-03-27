import { memo, useState } from "react";
import { Info, X } from "lucide-react";
import "../../styles/geo.css";

const Attribution = () => {
  const [opened, setOpened] = useState<boolean>(false);

  return (
    <div className="attribution-container">
      {opened ? (
        <div className="attribution-panel">
          <button
            className="attribution-close"
            onClick={() => setOpened(false)}
            aria-label="Close attribution"
          >
            <X size={14} />
          </button>
          <p>
            Map data ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap
            </a>{" "}
            contributors, licensed under{" "}
            <a
              href="https://opendatacommons.org/licenses/odbl/"
              target="_blank"
              rel="noopener noreferrer"
            >
              ODbL
            </a>
          </p>
        </div>
      ) : (
        <button
          className="attribution-toggle"
          onClick={() => setOpened(true)}
          aria-label="Show attribution info"
        >
          <Info size={16} />
        </button>
      )}
    </div>
  );
};

export default memo(Attribution);
