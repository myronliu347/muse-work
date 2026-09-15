import React from "react";
import { DropdownMenu } from "@radix-ui/themes";
import { getOverlayHost } from "../../utils/bodyPortal";

export interface CommandMenuItem {
  id: string;
  label: string;
  /** codicon 图标类名（去掉 codicon- 前缀外的完整类，如 "codicon-trash"）。 */
  icon?: string;
  onClick: () => void;
}

interface CommandsMenuProps {
  items: CommandMenuItem[];
  /** Radix Trigger 包裹的按钮。 */
  trigger: React.ReactElement;
  /** 测试辅助：不经过指针交互直接打开菜单。 */
  defaultOpen?: boolean;
}

/** 会话标题后的指令下拉菜单：Radix DropdownMenu（与 PanelAddMenu 同款）。 */
export const CommandsMenu: React.FC<CommandsMenuProps> = ({
  items,
  trigger,
  defaultOpen,
}) => (
  <DropdownMenu.Root defaultOpen={defaultOpen}>
    <DropdownMenu.Trigger>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Content
      size="1"
      variant="soft"
      color="gray"
      highContrast
      align="end"
      sideOffset={4}
      container={getOverlayHost()}
      data-testid="command-menu"
    >
      {items.map((item) => (
        <DropdownMenu.Item
          key={item.id}
          onSelect={item.onClick}
          data-testid={`command-menu-${item.id}`}
        >
          {item.icon && (
            <span className={`codicon ${item.icon}`} aria-hidden="true" />
          )}
          {item.label}
        </DropdownMenu.Item>
      ))}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
);

export default CommandsMenu;
