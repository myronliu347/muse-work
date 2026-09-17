import React from "react";
import { useWelcomeWallpaper } from "./useWelcomeWallpaper";
import "../../styles/WelcomeView.css";

/** Shared photo + scrim behind the new-session page and automations list. */
export const WelcomeBackdrop: React.FC<{ testId?: string }> = ({
  testId = "new-session-wallpaper",
}) => {
  const wallpaper = useWelcomeWallpaper();
  return (
    <div className="new-session-page-backdrop" aria-hidden="true">
      <div
        className="new-session-page-wallpaper"
        style={{ backgroundImage: `url("${wallpaper}")` }}
        data-testid={testId}
      />
      <div className="new-session-page-scrim" />
    </div>
  );
};
