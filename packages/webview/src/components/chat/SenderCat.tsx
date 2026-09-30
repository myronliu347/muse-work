import React from "react";
import { useMuseTheme } from "../../ui/theme";
import senderCat from "../../assets/sender-cat.png";

/**
 * Decorative cat lying prone on the new-session composer.
 * Asset is a 2× PNG for HiDPI; CSS sizes it to logical pixels.
 * Hidden in light theme — the white cat does not read well on pale wallpaper.
 */
export const SenderCat: React.FC = () => {
  const { effective } = useMuseTheme();
  if (effective === "light") return null;
  return (
    <div
      className="new-session-sender-cat"
      data-testid="new-session-sender-cat"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      <img
        className="new-session-sender-cat-img"
        src={senderCat}
        alt=""
        width={170}
        height={110}
        draggable={false}
      />
    </div>
  );
};

export default SenderCat;
