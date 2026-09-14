import React from "react";
import { DropdownMenu } from "@radix-ui/themes";
import type { DesktopPanelKind } from "../../types";
import { panelShortcutLabel } from "../../muse/panelShortcuts";
import { PANEL_ADD_ORDER, PANEL_TAB_LABELS } from "../../muse/panelTabs";
import { getOverlayHost } from "../../utils/bodyPortal";

export type PanelAddMenuProps = {
  checked: DesktopPanelKind[];
  disabled?: DesktopPanelKind[];
  onAdd: (kind: DesktopPanelKind) => void;
  /** Trigger button; Radix Trigger wraps it with asChild. */
  trigger: React.ReactElement;
  /** Test helper — opens the menu without a pointer interaction. */
  defaultOpen?: boolean;
};

export const PanelAddMenu: React.FC<PanelAddMenuProps> = ({
  checked,
  disabled = [],
  onAdd,
  trigger,
  defaultOpen,
}) => {
  const items = PANEL_ADD_ORDER.filter(
    (kind) => !checked.includes(kind) && !disabled.includes(kind),
  );
  if (items.length === 0) return null;

  return (
    <DropdownMenu.Root defaultOpen={defaultOpen}>
      <DropdownMenu.Trigger>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Content
        size="1"
        variant="soft"
        color="gray"
        highContrast
        align="start"
        sideOffset={4}
        container={getOverlayHost()}
        data-testid="panel-add-menu"
      >
        {items.map((kind) => (
          <DropdownMenu.Item
            key={kind}
            shortcut={panelShortcutLabel(kind)}
            data-testid={`panel-add-item-${kind}`}
            onSelect={() => onAdd(kind)}
          >
            {PANEL_TAB_LABELS[kind]}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
};

export default PanelAddMenu;
