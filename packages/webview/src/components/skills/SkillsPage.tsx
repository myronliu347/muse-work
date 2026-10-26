import { useCallback, useEffect, useRef, useState } from "react";
import type { MuseApiClient } from "../../muse/apiClient";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import "../../styles/SkillsPage.css";

type InstalledSkill = { name: string; description: string; path: string };
type MarketSkill = {
  source: string;
  skillId: string;
  name: string;
  installs: number;
  isOfficial?: boolean;
};
type Selection =
  | { kind: "installed"; skill: InstalledSkill }
  | { kind: "market"; skill: MarketSkill };

const SEGMENT = /^[A-Za-z0-9._-]+$/;

function isGitHubSource(source: string): boolean {
  const parts = source.split("/");
  if (parts.length !== 2) return false;
  return parts.every(
    (part) => SEGMENT.test(part) && part !== "." && part !== "..",
  );
}

function tailPath(skillPath: string): string {
  return skillPath.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : "安装失败";
  return raw.replace(/^Muse API \d+:\s*/, "");
}

function formatInstalls(count: number): string {
  if (count >= 10000) {
    const wan = count / 10000;
    const text = wan.toFixed(wan >= 10 ? 0 : 1).replace(/\.0$/, "");
    return `${text} 万次安装`;
  }
  return `${count} 次安装`;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const SkillsStatus: React.FC<{
  title: string;
  hint?: string;
  icon: "puzzle" | "search" | "loading";
  action?: { label: string; onClick: () => void };
}> = ({ title, hint, icon, action }) => (
  <div className="skills-status" role="status">
    <div className="skills-status-mark" aria-hidden="true">
      {icon === "loading" ? (
        <svg className="skills-status-spin" viewBox="0 0 24 24" width="22" height="22">
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.28" />
          <path d="M12 4a8 8 0 0 1 8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : icon === "search" ? (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M15.2 15.2 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            d="M5.2 7.2V19.2H16.6V16.4A3 3 0 0 1 16.6 10.8V7.2H14.2A3 3 0 0 0 8.6 7.2H5.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
    <p className="skills-status-title">{title}</p>
    {hint ? <p className="skills-status-hint">{hint}</p> : null}
    {action ? (
      <button type="button" className="skills-btn skills-btn-primary" onClick={action.onClick}>
        {action.label}
      </button>
    ) : null}
  </div>
);

export const SkillsPage: React.FC<{
  api: MuseApiClient;
  onRunInTerminal?: (command: string) => void;
}> = ({ api, onRunInTerminal }) => {
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [installedLoading, setInstalledLoading] = useState(true);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [market, setMarket] = useState<MarketSkill[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [pendingUninstall, setPendingUninstall] = useState<InstalledSkill | null>(
    null,
  );
  const [tab, setTab] = useState<"installed" | "market">("installed");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drawer, setDrawer] = useState<Selection | null>(null);
  const [closing, setClosing] = useState(false);
  const drawerRef = useRef<Selection | null>(null);
  const [detailDescription, setDetailDescription] = useState("");
  const [detailBody, setDetailBody] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [summaryTick, setSummaryTick] = useState(0);
  const summaryRef = useRef<Record<string, string>>({});

  const loadInstalled = useCallback(async () => {
    setInstalledLoading(true);
    try {
      const res = await api.listInstalledSkills();
      setInstalled(res.skills);
      setInstalledError(null);
    } catch (err) {
      setInstalledError(errorText(err));
    } finally {
      setInstalledLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const q = debounced.trim();
    let cancelled = false;
    setMarketLoading(true);
    setMarketError(null);
    const request =
      q.length >= 2 ? api.getSkillMarket({ q }) : api.getSkillMarket({ page: 0 });
    void request
      .then((res) => {
        if (cancelled) return;
        setMarket(res.skills);
        setHasMore(q.length >= 2 ? false : res.hasMore);
        setPage(0);
      })
      .catch((err) => {
        if (cancelled) return;
        setMarket([]);
        setMarketError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setMarketLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, debounced]);

  useEffect(() => {
    const pending = market
      .filter((skill) => summaryRef.current[`${skill.source}/${skill.skillId}`] === undefined)
      .slice(0, 24);
    if (pending.length === 0) return;
    const keys = pending.map((skill) => `${skill.source}/${skill.skillId}`);
    for (const key of keys) summaryRef.current[key] = "";
    let cancelled = false;
    let settled = false;
    void api
      .getMarketSkillSummaries(
        pending.map((skill) => ({ source: skill.source, skillId: skill.skillId })),
      )
      .then((res) => {
        if (cancelled) return;
        settled = true;
        setDescriptions((prev) => {
          const next = { ...prev };
          for (const row of res.summaries) {
            next[`${row.source}/${row.skillId}`] = row.description;
          }
          return next;
        });
        setCommands((prev) => {
          const next = { ...prev };
          for (const row of res.summaries) {
            if (row.command) next[`${row.source}/${row.skillId}`] = row.command;
          }
          return next;
        });
        setSummaryTick((tick) => tick + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (!settled) {
        for (const key of keys) delete summaryRef.current[key];
      }
    };
  }, [api, market, summaryTick]);

  useEffect(() => {
    if (selection) {
      drawerRef.current = selection;
      setClosing(false);
      setDrawer(selection);
      return;
    }
    if (!drawerRef.current) return;
    if (prefersReducedMotion()) {
      drawerRef.current = null;
      setDrawer(null);
      setClosing(false);
      return;
    }
    setClosing(true);
  }, [selection]);

  useEffect(() => {
    if (!drawer || pendingUninstall) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, pendingUninstall]);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      drawerRef.current = null;
      setDrawer(null);
      setClosing(false);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    setDetailError(null);
    setDetailBody("");
    if (selection.kind === "installed") {
      setDetailDescription(selection.skill.description);
      setDetailLoading(true);
      void api
        .getInstalledSkillDetail(selection.skill.path)
        .then((res) => {
          if (cancelled) return;
          setDetailDescription(res.description);
          setDetailBody(res.body);
        })
        .catch((err) => {
          if (!cancelled) setDetailError(errorText(err));
        })
        .finally(() => {
          if (!cancelled) setDetailLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    setDetailDescription("");
    setDetailLoading(true);
    void api
      .getMarketSkillDetail({
        source: selection.skill.source,
        skillId: selection.skill.skillId,
      })
      .then((res) => {
        if (cancelled) return;
        setDetailDescription(res.description);
        setDetailBody(res.body);
        if (res.command) {
          const key = `${selection.skill.source}/${selection.skill.skillId}`;
          setCommands((prev) => ({ ...prev, [key]: res.command }));
        }
      })
      .catch((err) => {
        if (!cancelled) setDetailError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selection]);

  const installedNames = new Set(
    installed.map((skill) => skill.name.toLowerCase()),
  );
  const searching = debounced.trim().length >= 2;

  const install = async (skill: MarketSkill) => {
    const key = `${skill.source}/${skill.skillId}`;
    setInstalling(key);
    setRowError((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      await api.installMarketSkill({
        source: skill.source,
        skillId: skill.skillId,
      });
      await loadInstalled();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [key]: errorText(err) }));
    } finally {
      setInstalling(null);
    }
  };

  const loadMore = async () => {
    const next = page + 1;
    setLoadingMore(true);
    try {
      const res = await api.getSkillMarket({ page: next });
      setMarket((prev) => [...prev, ...res.skills]);
      setPage(next);
      setHasMore(res.hasMore);
    } catch (err) {
      setMarketError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const openSelection = (next: Selection) => {
    drawerRef.current = next;
    setClosing(false);
    setDrawer(next);
    setDetailError(null);
    setDetailBody("");
    setDetailLoading(true);
    setDetailDescription(next.kind === "installed" ? next.skill.description : "");
    setSelection(next);
  };

  const closeIfBackdrop = (event: React.MouseEvent) => {
    if (!selection) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        ".skills-detail, .skills-card, .skills-row, .skills-search, .skills-tabs, button, input, a",
      )
    ) {
      return;
    }
    setSelection(null);
  };

  const selectedInstalled =
    selection?.kind === "installed" ? selection.skill : null;
  const selectedMarket = selection?.kind === "market" ? selection.skill : null;
  const selectedMarketKey = selectedMarket
    ? `${selectedMarket.source}/${selectedMarket.skillId}`
    : "";
  const selectedInstalledAlready = selectedMarket
    ? installedNames.has(selectedMarket.skillId.toLowerCase())
    : false;
  const selectedGitHub = selectedMarket
    ? isGitHubSource(selectedMarket.source)
    : false;

  return (
    <div className="skills-page" data-testid="skills-page" onClick={closeIfBackdrop}>
      <header className="skills-page-bar">
        <h1>技能</h1>
        <div className="skills-tabs" role="tablist" aria-label="技能">
          <button
            type="button"
            role="tab"
            className="skills-tab"
            aria-selected={tab === "installed"}
            onClick={() => {
              setTab("installed");
              setSelection(null);
            }}
          >
            已安装
          </button>
          <button
            type="button"
            role="tab"
            className="skills-tab"
            aria-selected={tab === "market"}
            onClick={() => {
              setTab("market");
              setSelection(null);
            }}
          >
            技能市场
          </button>
        </div>
      </header>
      <div className="skills-page-body">
        <div className="skills-page-scroll">
          <div className="skills-page-inner">
            {tab === "installed" ? (
            <section className="skills-section">
              {installedError ? (
                <div className="skills-error">{installedError}</div>
              ) : null}
              {installedLoading && installed.length === 0 ? (
                <SkillsStatus title="正在加载已安装的技能" icon="loading" />
              ) : installed.length === 0 && !installedError ? (
                <SkillsStatus
                  title="还没有安装技能"
                  hint="从技能市场安装之后，所有会话都能用。"
                  icon="puzzle"
                  action={{
                    label: "去技能市场",
                    onClick: () => {
                      setTab("market");
                      setSelection(null);
                    },
                  }}
                />
              ) : installed.length > 0 ? (
                <div className="skills-list">
                  {installed.map((skill) => (
                    <div
                      className={`skills-row${selectedInstalled?.path === skill.path ? " is-selected" : ""}`}
                      key={skill.path}
                    >
                      <button
                        type="button"
                        className="skills-row-open"
                        onClick={() =>
                          openSelection({ kind: "installed", skill })
                        }
                      >
                        <div className="skills-row-title">{skill.name}</div>
                        <div className="skills-row-sub">
                          <span>{skill.description}</span>
                          <span>{tailPath(skill.path)}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="skills-btn skills-btn-danger"
                        onClick={() => setPendingUninstall(skill)}
                      >
                        卸载
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
            ) : (
            <section className="skills-section">
              <label className="skills-search">
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10.5 10.5 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <input
                  value={query}
                  placeholder="搜索技能"
                  aria-label="搜索技能"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {marketError ? (
                <div className="skills-error">{marketError}</div>
              ) : null}
              {marketLoading ? (
                <SkillsStatus title="正在加载技能" icon="loading" />
              ) : market.length === 0 && !marketError ? (
                <SkillsStatus
                  title={searching ? "没有找到技能" : "市场上暂时没有技能"}
                  hint={searching ? "换个关键词试试。" : "过一会儿再来看看。"}
                  icon={searching ? "search" : "puzzle"}
                />
              ) : market.length > 0 ? (
                <div className="skills-grid">
                  {market.map((skill) => {
                    const key = `${skill.source}/${skill.skillId}`;
                    const installedAlready = installedNames.has(
                      skill.skillId.toLowerCase(),
                    );
                    const github = isGitHubSource(skill.source);
                    const busy = installing === key;
                    const command = commands[key] ?? "";
                    const label = installedAlready
                      ? "已安装"
                      : !github
                        ? "在终端安装"
                        : busy
                          ? "安装中"
                          : "安装";
                    return (
                      <div
                        className={`skills-card${selectedMarketKey === key ? " is-selected" : ""}`}
                        key={key}
                        data-testid={`skill-card-${skill.skillId}`}
                      >
                        <button
                          type="button"
                          className="skills-card-open"
                          aria-label={skill.name}
                          onClick={() =>
                            openSelection({ kind: "market", skill })
                          }
                        >
                          <span className="skills-card-title">
                            {skill.name}
                            {skill.isOfficial ? (
                              <span className="skills-pill">官方</span>
                            ) : null}
                          </span>
                          {descriptions[key] ? (
                            <span className="skills-card-desc">{descriptions[key]}</span>
                          ) : null}
                          <span className="skills-card-source">{skill.source}</span>
                          {command ? (
                            <code className="skills-card-command">{command}</code>
                          ) : null}
                          <span className="skills-card-meta">
                            {formatInstalls(skill.installs)}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`skills-btn${!installedAlready && (github || command) ? " skills-btn-primary" : ""}`}
                          disabled={installedAlready || (github ? busy : !command)}
                          onClick={() => {
                            if (!github && command) onRunInTerminal?.(command);
                            else void install(skill);
                          }}
                        >
                          {label}
                        </button>
                        {rowError[key] ? (
                          <div className="skills-error">{rowError[key]}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {hasMore && !searching && !marketLoading ? (
                <button
                  type="button"
                  className="skills-btn"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "加载中" : "加载更多"}
                </button>
              ) : null}
            </section>
            )}
          </div>
        </div>
      </div>
      {drawer ? (
        <aside
          className={`skills-detail${closing ? " is-closing" : ""}`}
          role="dialog"
          aria-label={drawer.skill.name}
          data-testid="skill-detail"
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget || !closing) return;
            drawerRef.current = null;
            setDrawer(null);
            setClosing(false);
          }}
        >
          <div className="skills-detail-head">
            <h2>{drawer.skill.name}</h2>
            <button
              type="button"
              className="skills-btn"
              onClick={() => setSelection(null)}
            >
              关闭
            </button>
          </div>
          <div className="skills-detail-meta">
            {drawer.kind === "installed" ? (
              <span>{tailPath(drawer.skill.path)}</span>
            ) : (
              <>
                <span>{drawer.skill.source}</span>
                <span>{formatInstalls(drawer.skill.installs)}</span>
                {drawer.skill.isOfficial ? (
                  <span className="skills-pill">官方</span>
                ) : null}
              </>
            )}
          </div>
          {detailError ? (
            <div className="skills-error">{detailError}</div>
          ) : null}
          {detailLoading ? (
            <SkillsStatus title="正在读取说明" icon="loading" />
          ) : (
            <div className="skills-detail-copy">
              {detailDescription ? <p>{detailDescription}</p> : null}
              {detailBody ? (
                <pre className="skills-detail-body">{detailBody}</pre>
              ) : null}
            </div>
          )}
          {drawer.kind === "market" &&
          commands[`${drawer.skill.source}/${drawer.skill.skillId}`] ? (
            <code className="skills-detail-command">
              {commands[`${drawer.skill.source}/${drawer.skill.skillId}`]}
            </code>
          ) : null}
          <div className="skills-detail-actions">
            {drawer.kind === "installed" ? (
              <button
                type="button"
                className="skills-btn skills-btn-danger"
                onClick={() => setPendingUninstall(drawer.skill)}
              >
                卸载
              </button>
            ) : (
              <button
                type="button"
                className={`skills-btn${
                  !selectedInstalledAlready &&
                  (selectedGitHub || commands[selectedMarketKey])
                    ? " skills-btn-primary"
                    : ""
                }`}
                disabled={
                  selectedInstalledAlready ||
                  (selectedGitHub ? installing === selectedMarketKey : !commands[selectedMarketKey])
                }
                onClick={() => {
                  const command = commands[selectedMarketKey];
                  if (!selectedGitHub && command) onRunInTerminal?.(command);
                  else if (drawer.kind === "market") void install(drawer.skill);
                }}
              >
                {selectedInstalledAlready
                  ? "已安装"
                  : !selectedGitHub
                    ? "在终端安装"
                    : installing === selectedMarketKey
                      ? "安装中"
                      : "安装"}
              </button>
            )}
            {drawer.kind === "market" && rowError[selectedMarketKey] ? (
              <div className="skills-error">{rowError[selectedMarketKey]}</div>
            ) : null}
          </div>
        </aside>
      ) : null}
      {pendingUninstall ? (
        <ConfirmDialog
          title="卸载这个技能？"
          description="已经打开的会话要到下一轮才会停用它。"
          confirmText="卸载"
          onCancel={() => setPendingUninstall(null)}
          onConfirm={() => {
            const target = pendingUninstall;
            setPendingUninstall(null);
            if (selectedInstalled?.path === target.path) setSelection(null);
            void api
              .uninstallInstalledSkill(target.path)
              .then(() => loadInstalled())
              .catch((err) => setInstalledError(errorText(err)));
          }}
        />
      ) : null}
    </div>
  );
};
