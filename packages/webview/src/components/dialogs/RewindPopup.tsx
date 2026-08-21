import React, { useEffect, useState, useCallback } from "react";
import { Dialog, Button } from "@radix-ui/themes";
import "../../styles/RewindPopup.css";

export interface RewindCheckpoint {
  id: string;
  content: string;
}

interface RewindPopupProps {
  isVisible: boolean;
  isLoading: boolean;
  checkpoints: RewindCheckpoint[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

// Rewind picker as a Radix Dialog: all checkpoints listed in a modal,
// navigable with ArrowUp/ArrowDown, Enter to pick, Esc to cancel.
// Default selection is the most recent checkpoint (last in chronological order).
export const RewindPopup: React.FC<RewindPopupProps> = ({
  isVisible,
  isLoading,
  checkpoints,
  onSelect,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Select the most recent checkpoint whenever the list (re)loads.
  useEffect(() => {
    setSelectedIndex(Math.max(0, checkpoints.length - 1));
  }, [checkpoints]);

  // Grab keyboard focus while open; the content owns the keydown handler.
  useEffect(() => {
    if (isVisible) {
      const content = document.querySelector(
        '[data-testid="rewind-popup"]',
      ) as HTMLElement | null;
      content?.focus();
    }
  }, [isVisible]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(checkpoints.length - 1, prev + 1),
          );
          break;
        case "Enter":
          event.preventDefault();
          if (checkpoints[selectedIndex]) {
            onSelect(checkpoints[selectedIndex].id);
          }
          break;
      }
    },
    [checkpoints, selectedIndex, onSelect],
  );

  return (
    <Dialog.Root
      open={isVisible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        data-testid="rewind-popup"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        size="3"
        aria-describedby={undefined}
      >
        <Dialog.Title className="rewind-popup-title">
          选择要回滚到的消息
        </Dialog.Title>
        {isLoading ? (
          <div className="rewind-popup-loading">
            <span className="codicon codicon-loading codicon-modifier-spin"></span>
            正在加载...
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="rewind-popup-empty">没有可回滚的用户消息</div>
        ) : (
          <ul className="rewind-popup-list">
            {checkpoints.map((checkpoint, index) => (
              <li
                key={checkpoint.id}
                className={`rewind-popup-item ${index === selectedIndex ? "selected" : ""}`}
                onClick={() => onSelect(checkpoint.id)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {checkpoint.content}
              </li>
            ))}
          </ul>
        )}
        <div className="rewind-popup-actions">
          <Dialog.Close>
            <Button size="1" variant="soft" color="gray">
              取消
            </Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default RewindPopup;
