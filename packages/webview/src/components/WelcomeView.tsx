/**
 * WelcomeView - Centered welcome page for unauthenticated / empty-chat state.
 *
 * Shown in place of MessageList when there are no messages yet. The login
 * button + "登录后即可开始使用" line are only rendered when the user is neither
 * authenticated nor has a direct-connect config (baseURL + apiKey), since a
 * direct-connect config works without logging in.
 */

import React from "react";
import museM from "../assets/muse-m.svg";

export interface WelcomeViewProps {
  isAuthenticated: boolean;
  hasDirectConnectConfig: boolean;
  onLogin: () => void;
}

const FONT_FAMILY = '"PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

const WelcomeView: React.FC<WelcomeViewProps> = ({
  isAuthenticated,
  hasDirectConnectConfig,
  onLogin,
}) => {
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
        {/* Geometric red M mark */}
        <img
          src={museM}
          width={40}
          height={40}
          alt=""
          draggable={false}
          data-testid="welcome-muse-logo"
          style={{
            display: "block",
            flexShrink: 0,
            objectFit: "contain",
          }}
        />

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
              color: "var(--gray-12)",
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
              color: "var(--gray-11)",
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
                color: "var(--gray-11)",
                lineHeight: "26px",
              }}
            >
              登录后即可开始使用~
            </div>
          )}
        </div>

        {showLogin && (
          <button
            type="button"
            onClick={onLogin}
            style={{
              width: "100%",
              height: "32px",
              minHeight: "32px",
              background: "var(--accent-9)",
              color: "#ffffff",
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
