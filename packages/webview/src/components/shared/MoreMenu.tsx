import React from "react";
import { DropdownMenu } from "@radix-ui/themes";

interface MoreMenuProps {
  /** Radix Trigger 包裹的按钮（更多）。 */
  trigger: React.ReactElement;
  onOpenSettings: () => void;
  onLogin: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
}

/** 更多下拉菜单（设置/登录/退出登录）：Radix DropdownMenu。 */
export const MoreMenu: React.FC<MoreMenuProps> = ({
  trigger,
  onOpenSettings,
  onLogin,
  onLogout,
  isAuthenticated,
}) => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Content
      size="1"
      variant="soft"
      color="gray"
      highContrast
      align="end"
      sideOffset={4}
      data-testid="more-menu"
    >
      <DropdownMenu.Item onSelect={onOpenSettings} data-testid="more-menu-settings">
        <span className="codicon codicon-settings" aria-hidden="true" />
        设置
      </DropdownMenu.Item>
      {isAuthenticated ? (
        <DropdownMenu.Item onSelect={onLogout} data-testid="more-menu-logout">
          <span className="codicon codicon-sign-out" aria-hidden="true" />
          退出登录
        </DropdownMenu.Item>
      ) : (
        <DropdownMenu.Item onSelect={onLogin} data-testid="more-menu-login">
          <span className="codicon codicon-sign-in" aria-hidden="true" />
          登录
        </DropdownMenu.Item>
      )}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
);

export default MoreMenu;
