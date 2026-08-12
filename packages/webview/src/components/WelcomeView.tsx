/**
 * WelcomeView - Centered welcome page for unauthenticated / empty-chat state.
 *
 * Shown in place of MessageList when there are no messages yet. The login
 * button + "登录后即可开始使用" line are only rendered when the user is neither
 * authenticated nor has a direct-connect config (baseURL + apiKey), since a
 * direct-connect config works without logging in.
 *
 * Design ref: Figma 2171:1482.
 */

import React from "react";

export interface WelcomeViewProps {
  isAuthenticated: boolean;
  hasDirectConnectConfig: boolean;
  onLogin: () => void;
}

// Muse Work logo placeholder (solid mark until final brand assets land).
const MuseLogo: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: "block" }}
  >
    <text
      x="10"
      y="14"
      textAnchor="middle"
      fill="white"
      fontSize="13"
      fontWeight="700"
      fontFamily='"PingFang SC", sans-serif'
    >
      M
    </text>
  </svg>
);

const FONT_FAMILY = '"PingFang SC", var(--vscode-font-family, sans-serif)';

const WelcomeView: React.FC<WelcomeViewProps> = ({
  isAuthenticated,
  hasDirectConnectConfig,
  onLogin,
}) => {
  // Login UI is only relevant when the user can neither use a direct-connect
  // config nor is already authenticated.
  const showLogin = !isAuthenticated && !hasDirectConnectConfig;
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "auto",
      }}
    >
      <div
        style={{
          width: "400px",
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "24px",
          padding: "0 16px",
        }}
      >
        {/* Logo */}
        <div
          style={{
            width: "32px",
            height: "32px",
            background: "var(--vscode-brand-primary, #c1292e)",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <MuseLogo size={20} />
        </div>

        {/* Text area */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            textAlign: "center",
            width: "100%",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              fontFamily: FONT_FAMILY,
              fontWeight: 600,
              color: "var(--vscode-foreground, white)",
              lineHeight: "18px",
            }}
          >
            Hi~ 欢迎使用 Muse
          </div>
          <div
            style={{
              fontSize: "13px",
              fontFamily: FONT_FAMILY,
              fontWeight: 400,
              color: "var(--vscode-descriptionForeground, #8c8c8c)",
              lineHeight: "26px",
            }}
          >
            我是您的AI助手，可以帮您处理项目、编写代码或修改文件。
          </div>
          {showLogin && (
            <div
              style={{
                fontSize: "13px",
                fontFamily: FONT_FAMILY,
                fontWeight: 400,
                color: "var(--vscode-descriptionForeground, #8c8c8c)",
                lineHeight: "26px",
              }}
            >
              登录后即可开始使用~
            </div>
          )}
        </div>

        {/* Login button (only when login is required) — full-width, label centered */}
        {showLogin && (
          <button
            type="button"
            onClick={onLogin}
            style={{
              width: "100%",
              height: "32px",
              minHeight: "32px",
              background: "var(--vscode-brand-primary, #c1292e)",
              color: "var(--vscode-button-foreground, white)",
              border: "none",
              borderRadius: "6px",
              fontSize: "13px",
              fontFamily: FONT_FAMILY,
              fontWeight: 600,
              lineHeight: "18px",
              cursor: "pointer",
              padding: "7px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            登 录
          </button>
        )}
      </div>
    </div>
  );
};

export default WelcomeView;
