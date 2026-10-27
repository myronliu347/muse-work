import React from "react";
import "../../styles/NewSessionPage.css";
import "../../styles/WelcomeView.css";
import { SenderCat } from "./SenderCat";

export interface NewSessionPageProps {
  welcome: React.ReactNode;
  composer: React.ReactNode;
  onComposerFocus?: () => void;
}

/** Centered draft-only start page: welcome copy above the chat composer. */
export const NewSessionPage: React.FC<NewSessionPageProps> = ({
  welcome,
  composer,
  onComposerFocus,
}) => {
  return (
    <div className="new-session-page" data-testid="new-session-page">
      <div className="new-session-page-column">
        <div className="new-session-page-welcome">{welcome}</div>
        <div
          className="new-session-page-composer"
          data-testid="new-session-page-composer"
          onFocus={onComposerFocus}
        >
          {composer}
          <SenderCat />
        </div>
      </div>
    </div>
  );
};

export default NewSessionPage;
