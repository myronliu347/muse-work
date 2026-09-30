import React from "react";
import { WELCOME_PROMPTS } from "./welcomePrompts";
import { useMuseTheme } from "../../ui/theme";
import museM from "../../assets/muse-m.png";
import "../../styles/WelcomeView.css";

export interface WelcomeViewProps {
  isAuthenticated: boolean;
  hasDirectConnectConfig: boolean;
  onLogin: () => void;
  /** When true, skip the full-height flex shell (parent owns centering). */
  embedded?: boolean;
  /** Fill the composer with a starter prompt; do not send. */
  onSelectPrompt?: (text: string) => void;
}

const WelcomeView: React.FC<WelcomeViewProps> = ({
  isAuthenticated,
  hasDirectConnectConfig,
  onLogin,
  embedded = false,
  onSelectPrompt,
}) => {
  const { effective } = useMuseTheme();
  const showLogo = effective !== "light";
  const showLogin = !isAuthenticated && !hasDirectConnectConfig;
  const inner = (
    <div className="welcome-view">
      <h1 className="welcome-headline" data-testid="welcome-headline">
        {showLogo ? (
          <img
            src={museM}
            alt=""
            className="welcome-headline-logo"
            width={64}
            height={64}
            draggable={false}
          />
        ) : null}
        今天想让我帮你做些什么？
      </h1>
      <div className="welcome-cards" data-testid="welcome-cards">
        {WELCOME_PROMPTS.map((card) => (
          <button
            key={card.id}
            type="button"
            className="welcome-card"
            data-testid={`welcome-card-${card.id}`}
            onClick={() => onSelectPrompt?.(card.prompt)}
          >
            <span className="welcome-card-icon" aria-hidden="true">
              <i className={`codicon codicon-${card.icon}`} />
            </span>
            <span className="welcome-card-title">{card.title}</span>
            <span className="welcome-card-desc">{card.description}</span>
          </button>
        ))}
      </div>
      {showLogin && (
        <div className="welcome-login" data-testid="welcome-login">
          <div className="welcome-login-hint">登录后即可开始使用~</div>
          <button type="button" className="welcome-login-btn" onClick={onLogin}>
            登 录
          </button>
        </div>
      )}
    </div>
  );

  if (embedded) return inner;

  return (
    <div className="welcome-view-shell" data-testid="welcome-view">
      {inner}
    </div>
  );
};

export default WelcomeView;
