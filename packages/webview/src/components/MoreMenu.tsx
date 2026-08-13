import React, { useEffect, useRef } from "react";
import "../styles/MoreMenu.css";

interface MoreMenuProps {
  onOpenSettings?: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onClose: () => void;
  isAuthenticated: boolean;
  /**
   * Label of the auth subject this menu's 登录/退出登录 entry acts on —
   * set by the desktop host to the focused pane's host (e.g. 'lyq.u',
   * '本地'). Absent for hosts without the concept (VSCE/JetBrains), in which
   * case the entry shows no annotation.
   */
  hostLabel?: string;
  /** Hide the settings row (settings lives on a dedicated sidebar button). */
  hideSettings?: boolean;
  /** Extra class for placement (e.g. footer menu opens upward). */
  className?: string;
}

export const MoreMenu: React.FC<MoreMenuProps> = ({
  onOpenSettings,
  onLogin,
  onLogout,
  onClose,
  isAuthenticated,
  hostLabel,
  hideSettings = false,
  className,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleSettings = () => {
    onOpenSettings?.();
    onClose();
  };

  const handleLogout = () => {
    onLogout();
    onClose();
  };

  const handleLogin = () => {
    onLogin();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className={["more-menu", className].filter(Boolean).join(" ")}
      data-testid="more-menu"
    >
      {!hideSettings && onOpenSettings ? (
        <div
          className="more-menu-item"
          onClick={handleSettings}
          data-testid="more-menu-settings"
        >
          设置{hostLabel ? `（${hostLabel}）` : ""}
        </div>
      ) : null}
      {isAuthenticated ? (
        <div
          className="more-menu-item"
          onClick={handleLogout}
          data-testid="more-menu-logout"
        >
          退出登录{hostLabel ? `（${hostLabel}）` : ""}
        </div>
      ) : (
        <div
          className="more-menu-item"
          onClick={handleLogin}
          data-testid="more-menu-login"
        >
          登录{hostLabel ? `（${hostLabel}）` : ""}
        </div>
      )}
    </div>
  );
};

export default MoreMenu;
