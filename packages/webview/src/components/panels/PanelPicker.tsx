import React from "react";
import type { DesktopPanelKind } from "../../types";
import { newTerminalShortcutLabel, panelShortcutLabel } from "../../muse/panelShortcuts";
import { PANEL_TAB_LABELS } from "../../muse/panelTabs";
import "../../styles/PanelPicker.css";

const PICKER_COPY: Record<
  DesktopPanelKind,
  { label: string; hint: string; icon: string; tone: string }
> = {
  file: {
    label: "工作区文件",
    hint: "浏览会话工作区的文件",
    icon: "codicon-folder",
    tone: "file",
  },
  terminal: {
    label: "新建终端",
    hint: "在会话工作区运行命令",
    icon: "codicon-terminal",
    tone: "blue",
  },
  preview: {
    label: "浏览器",
    hint: "浏览网页",
    icon: "codicon-globe",
    tone: "blue",
  },
  diff: {
    label: "变更",
    hint: "查看工作区改动",
    icon: "codicon-diff",
    tone: "muted",
  },
};

export function PanelPicker({
  items,
  onPick,
}: {
  items: DesktopPanelKind[];
  onPick: (kind: DesktopPanelKind) => void;
}) {
  return (
    <div className="panel-picker" data-testid="panel-picker">
      <i className="codicon codicon-compass panel-picker-mark" aria-hidden />
      <div className="panel-picker-list">
        {items.map((kind) => {
          const copy = PICKER_COPY[kind];
          return (
            <button
              key={kind}
              type="button"
              className="panel-picker-card"
              data-testid={`panel-add-item-${kind}`}
              onClick={() => onPick(kind)}
            >
              <i
                className={`codicon ${copy.icon} panel-picker-icon is-${copy.tone}`}
                aria-hidden
              />
              <span className="panel-picker-copy">
                <span className="panel-picker-title">
                  {copy.label || PANEL_TAB_LABELS[kind]}
                </span>
                <span className="panel-picker-hint">{copy.hint}</span>
              </span>
              <span className="panel-picker-shortcut">
                {kind === "terminal"
                  ? newTerminalShortcutLabel()
                  : panelShortcutLabel(kind)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
