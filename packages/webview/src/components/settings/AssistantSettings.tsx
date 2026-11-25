import { useMemo, useState } from "react";
import { MuseApiClient } from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { AssistantHandoffSettings } from "./AssistantHandoffSettings";
import { AssistantLearningLibrary } from "./AssistantLearningLibrary";
import { MemoryDreamSettings } from "./MemoryDreamSettings";
import "../../styles/AssistantSettings.css";

type Section = "handoff" | "memory" | "library";

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: "handoff", label: "每日收工", icon: "history" },
  { id: "memory", label: "记忆整理", icon: "database" },
  { id: "library", label: "知识库", icon: "book" },
];

export function AssistantSettings({ api }: { api?: MuseApiClient }) {
  const client = useMemo(
    () => api ?? new MuseApiClient({ baseUrl: resolveMuseServerUrl() }),
    [api],
  );
  const [section, setSection] = useState<Section>("handoff");

  return (
    <div className="as-root" data-testid="assistant-settings">
      <nav className="as-nav" aria-label="助手设置">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`as-nav-item${section === item.id ? " is-active" : ""}`}
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => setSection(item.id)}
          >
            <i
              className={`codicon codicon-${item.icon}`}
              aria-hidden="true"
            />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="as-content">
        {section === "handoff" ? (
          <AssistantHandoffSettings api={client} />
        ) : null}
        {section === "memory" ? <MemoryDreamSettings api={client} /> : null}
        {section === "library" ? (
          <AssistantLearningLibrary api={client} />
        ) : null}
      </div>
    </div>
  );
}

export default AssistantSettings;
