import React, { useEffect, useMemo, useState } from "react";
import { Badge, Button, Dialog } from "@radix-ui/themes";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { MuseApiClient } from "../../muse/apiClient";
import { getOverlayHost } from "../../utils/bodyPortal";
import { MarkdownView } from "../message/MarkdownView";

type Tab = "memory" | "rules" | "skills";

type Library = Awaited<ReturnType<MuseApiClient["getMemoryDreamLearning"]>>;

type Item = {
  id: string;
  title: string;
  description: string;
  type?: string;
  content: string;
};

const TYPE_LABEL: Record<string, string> = {
  user: "用户",
  feedback: "反馈",
  project: "项目",
  reference: "参考",
};

function parseFrontmatter(content: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { data: {}, body: content.trim() };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    data[pair[1]] = pair[2].replace(/^["']|["']$/g, "").trim();
  }
  return { data, body: content.slice(match[0].length).trim() };
}

function toHtml(content: string): string {
  const raw = marked.parse(content, { gfm: true, breaks: true });
  return DOMPurify.sanitize(typeof raw === "string" ? raw : "");
}

function humanize(name: string): string {
  return name
    .replace(/\.md$/i, "")
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AssistantLearningLibrary({ api }: { api: MuseApiClient }) {
  const [tab, setTab] = useState<Tab>("memory");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Library | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getMemoryDreamLearning();
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo<Item[]>(() => {
    if (!data) return [];
    if (tab === "memory") {
      return data.memory
        .filter((item) => item.name !== "MEMORY.md")
        .map((item) => {
          const fm = parseFrontmatter(item.content);
          return {
            id: item.name,
            title: fm.data.name || humanize(item.name),
            description: fm.data.description ?? "",
            type: fm.data.type,
            content: fm.body,
          };
        });
    }
    if (tab === "rules") {
      return data.rules.map((item) => {
        const fm = parseFrontmatter(item.content);
        return {
          id: item.name,
          title: fm.data.name || humanize(item.name),
          description: fm.data.description || item.description,
          type: "rule",
          content: fm.body,
        };
      });
    }
    return data.skills.map((item) => {
      const fm = parseFrontmatter(item.content);
      return {
        id: item.name,
        title: fm.data.name || humanize(item.name),
        description: fm.data.description || item.description,
        type: "skill",
        content: fm.body,
      };
    });
  }, [data, tab]);

  const active = items.find((item) => item.id === selected) ?? items[0];

  const counts = {
    memory:
      (data?.memory.length ?? 0) -
      (data?.memory.some((item) => item.name === "MEMORY.md") ? 1 : 0),
    rules: data?.rules.length ?? 0,
    skills: data?.skills.length ?? 0,
  };

  const changeTab = (next: Tab) => {
    setTab(next);
    setSelected(null);
  };

  return (
    <>
      <section className="md-card md-library is-collapsed">
        <div className="md-library-head">
          <div>
            <div className="md-toggle-title">当前助手知识库</div>
            <div className="md-target-hint">
              记忆 {counts.memory} · 规则 {counts.rules} · 技能 {counts.skills}
              <span className="md-library-sep"> · </span>
              待处理草稿请到「最近整理」里采纳
            </div>
          </div>
          <div className="md-library-actions">
            <Button
              size="1"
              variant="soft"
              onClick={() => {
                setOpen(true);
                if (!data) void load();
              }}
            >
              查看知识库
            </Button>
          </div>
        </div>
      </section>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content
          className="md-library-dialog"
          aria-describedby={undefined}
          container={getOverlayHost()}
        >
          <div className="md-library-dialog-head">
            <div>
              <Dialog.Title className="md-library-dialog-title">
                当前助手知识库
              </Dialog.Title>
              <div className="md-target-hint">
                记忆 {counts.memory} · 规则 {counts.rules} · 技能 {counts.skills}
              </div>
            </div>
            <div className="md-library-actions">
              <Button
                size="1"
                variant="soft"
                disabled={loading}
                onClick={() => void load()}
              >
                刷新
              </Button>
              <Dialog.Close>
                <Button size="1" variant="ghost" color="gray">
                  关闭
                </Button>
              </Dialog.Close>
            </div>
          </div>

          {error ? <p className="md-error">{error}</p> : null}

          <div className="md-library-tabs">
            {(
              [
                ["memory", "记忆", counts.memory],
                ["rules", "规则", counts.rules],
                ["skills", "技能", counts.skills],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className={`md-library-tab${tab === value ? " is-active" : ""}`}
                onClick={() => changeTab(value)}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <p className="md-empty">还没有内容。</p>
          ) : (
            <div className="md-library-body">
              <div className="md-library-list">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`md-library-item${item.id === active?.id ? " is-active" : ""}`}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="md-library-name">{item.title}</span>
                    {item.description ? (
                      <span className="md-library-desc">{item.description}</span>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="md-library-preview">
                {active ? (
                  <>
                    <div className="md-library-preview-head">
                      <span>{active.title}</span>
                      {active.type ? (
                        <Badge size="1" variant="soft" color="gray">
                          {TYPE_LABEL[active.type] ?? active.type}
                        </Badge>
                      ) : null}
                    </div>
                    <MarkdownView
                      className="md-library-markdown"
                      html={toHtml(active.content)}
                    />
                  </>
                ) : (
                  <p className="md-empty">选一项查看预览。</p>
                )}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
