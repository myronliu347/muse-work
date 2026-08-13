/**
 * LoadingLogo - Muse M mark with a light-sweep animation shown while the
 * initial state (auth, sessions) is being loaded.
 */

import React from "react";
import "../styles/LoadingLogo.css";
import museM from "../assets/muse-m.png";

const MMark: React.FC<{ size: number }> = ({ size }) => (
  <img
    src={museM}
    width={size}
    height={size}
    alt=""
    draggable={false}
    style={{ display: "block" }}
  />
);

const LoadingLogo: React.FC = () => (
  <div className="loading-logo-container">
    <div className="loading-logo">
      <div className="loading-logo-base">
        <MMark size={48} />
      </div>
      <div className="loading-logo-light" aria-hidden="true">
        <MMark size={48} />
      </div>
    </div>
  </div>
);

export default LoadingLogo;
