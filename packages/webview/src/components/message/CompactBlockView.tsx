import React, { useState } from "react";
import { QueueChevronIcon } from "../shared/HeaderIcons";
import { useHoldTranscriptScroll } from "../chat/holdTranscriptScroll";
import type { CompactBlock } from "../../types";

interface CompactBlockViewProps {
  block: CompactBlock;
  renderContent: (content: string) => React.ReactNode;
}

export const CompactBlockView: React.FC<CompactBlockViewProps> = ({
  block,
  renderContent,
}) => {
  // Compact summaries are always collapsed by default — show a hint line, expand on click.
  const [collapsed, setCollapsed] = useState(true);
  const holdScroll = useHoldTranscriptScroll();

  return (
    <div className="reasoning-block compact-block">
      <div
        className="reasoning-header"
        onClick={() => {
          holdScroll();
          setCollapsed((c) => !c);
        }}
      >
        <span className="reasoning-dot compact-dot" />
        <span className="reasoning-title">对话已压缩</span>
        <QueueChevronIcon
          className={`reasoning-chevron${collapsed ? "" : " expanded"}`}
        />
      </div>
      {!collapsed && (
        <div className="reasoning-content">
          {renderContent(block.content || "")}
        </div>
      )}
    </div>
  );
};
