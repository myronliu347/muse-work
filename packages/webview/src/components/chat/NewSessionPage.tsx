import React from "react";
import "../../styles/NewSessionPage.css";
import "../../styles/WelcomeView.css";
import { SenderCat } from "./SenderCat";
import { useWelcomeWallpaper } from "./useWelcomeWallpaper";

export interface NewSessionPageProps {
  welcome: React.ReactNode;
  composer: React.ReactNode;
}

/** Centered draft-only start page: welcome copy above the chat composer. */
export const NewSessionPage: React.FC<NewSessionPageProps> = ({
  welcome,
  composer,
}) => {
  const wallpaper = useWelcomeWallpaper();
  return (
    <div className="new-session-page" data-testid="new-session-page">
      <div className="new-session-page-backdrop" aria-hidden="true">
        <div
          className="new-session-page-wallpaper"
          style={{ backgroundImage: `url(${wallpaper})` }}
          data-testid="new-session-wallpaper"
        />
        <div className="new-session-page-scrim" />
      </div>
      <div className="new-session-page-column">
        <div className="new-session-page-welcome">{welcome}</div>
        <div
          className="new-session-page-composer"
          data-testid="new-session-page-composer"
        >
          <SenderCat />
          {composer}
        </div>
      </div>
    </div>
  );
};

export default NewSessionPage;
