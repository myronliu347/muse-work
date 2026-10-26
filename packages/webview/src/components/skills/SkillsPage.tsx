import { useCallback, useEffect, useState } from "react";
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

function monogram(name: string): string {
  const char = name.trim().charAt(0);
  return char ? char.toUpperCase() : "技";
}

export const SkillsPage: React.FC<{ api: MuseApiClient }> = ({ api }) => {
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [market, setMarket] = useState<MarketSkill[]>([]);
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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailDescription, setDetailDescription] = useState("");
  const [detailBody, setDetailBody] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadInstalled = useCallback(async () => {
    try {
      const res = await api.listInstalledSkills();
      setInstalled(res.skills);
      setInstalledError(null);
    } catch (err) {
      setInstalledError(errorText(err));
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
        setMarketError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api, debounced]);

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
    if (!isGitHubSource(selection.skill.source)) {
      setDetailDescription("");
      setDetailLoading(false);
      return;
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
    try {
      const res = await api.getSkillMarket({ page: next });
      setMarket((prev) => [...prev, ...res.skills]);
      setPage(next);
      setHasMore(res.hasMore);
    } catch (err) {
      setMarketError(errorText(err));
    }
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
    <div className="skills-page" data-testid="skills-page">
      <header className="skills-page-bar">
        <h1>技能</h1>
      </header>
      <div className="skills-page-body">
        <div className="skills-page-scroll">
          <div className="skills-page-inner">
            <section className="skills-section">
              <h2 className="skills-section-title">已安装</h2>
              {installedError ? (
                <div className="skills-error">{installedError}</div>
              ) : null}
              {installed.length === 0 && !installedError ? (
                <div className="skills-empty">还没有安装技能</div>
              ) : (
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
                          setSelection({ kind: "installed", skill })
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
              )}
            </section>
            <section className="skills-section">
              <div className="skills-market-head">
                <h2 className="skills-section-title">技能市场</h2>
                <input
                  className="skills-search"
                  value={query}
                  placeholder="搜索技能"
                  aria-label="搜索技能"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {marketError ? (
                <div className="skills-error">{marketError}</div>
              ) : null}
              {market.length === 0 && !marketError ? (
                <div className="skills-empty">没有找到技能</div>
              ) : (
                <div className="skills-grid">
                  {market.map((skill) => {
                    const key = `${skill.source}/${skill.skillId}`;
                    const installedAlready = installedNames.has(
                      skill.skillId.toLowerCase(),
                    );
                    const github = isGitHubSource(skill.source);
                    const busy = installing === key;
                    const label = installedAlready
                      ? "已安装"
                      : !github
                        ? "需用 CLI 安装"
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
                            setSelection({ kind: "market", skill })
                          }
                        >
                          <span className="skills-mark" aria-hidden="true">
                            {monogram(skill.name)}
                          </span>
                          <span className="skills-card-title">
                            {skill.name}
                            {skill.isOfficial ? (
                              <span className="skills-pill">官方</span>
                            ) : null}
                          </span>
                          <span className="skills-card-source">{skill.source}</span>
                          <span className="skills-card-meta">
                            {formatInstalls(skill.installs)}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`skills-btn${github && !installedAlready ? " skills-btn-primary" : ""}`}
                          disabled={installedAlready || !github || busy}
                          onClick={() => void install(skill)}
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
              )}
              {hasMore && !searching ? (
                <button
                  type="button"
                  className="skills-btn"
                  onClick={() => void loadMore()}
                >
                  加载更多
                </button>
              ) : null}
            </section>
          </div>
        </div>
        {selection ? (
          <aside className="skills-detail" data-testid="skill-detail">
            <div className="skills-detail-head">
              <h2>{selection.skill.name}</h2>
              <button
                type="button"
                className="skills-btn"
                onClick={() => setSelection(null)}
              >
                关闭
              </button>
            </div>
            <div className="skills-detail-meta">
              {selection.kind === "installed" ? (
                <span>{tailPath(selection.skill.path)}</span>
              ) : (
                <>
                  <span>{selection.skill.source}</span>
                  <span>{formatInstalls(selection.skill.installs)}</span>
                  {selection.skill.isOfficial ? (
                    <span className="skills-pill">官方</span>
                  ) : null}
                </>
              )}
            </div>
            {detailError ? (
              <div className="skills-error">{detailError}</div>
            ) : null}
            {detailLoading ? (
              <div className="skills-empty">正在读取说明</div>
            ) : (
              <div className="skills-detail-copy">
                {detailDescription ? <p>{detailDescription}</p> : null}
                {selectedMarket && !selectedGitHub ? (
                  <p>这个来源要在终端里安装。</p>
                ) : null}
                {detailBody ? (
                  <pre className="skills-detail-body">{detailBody}</pre>
                ) : null}
              </div>
            )}
            <div className="skills-detail-actions">
              {selectedInstalled ? (
                <button
                  type="button"
                  className="skills-btn skills-btn-danger"
                  onClick={() => setPendingUninstall(selectedInstalled)}
                >
                  卸载
                </button>
              ) : selectedMarket ? (
                <button
                  type="button"
                  className={`skills-btn${selectedGitHub && !selectedInstalledAlready ? " skills-btn-primary" : ""}`}
                  disabled={
                    selectedInstalledAlready ||
                    !selectedGitHub ||
                    installing === selectedMarketKey
                  }
                  onClick={() => void install(selectedMarket)}
                >
                  {selectedInstalledAlready
                    ? "已安装"
                    : !selectedGitHub
                      ? "需用 CLI 安装"
                      : installing === selectedMarketKey
                        ? "安装中"
                        : "安装"}
                </button>
              ) : null}
              {selectedMarket && rowError[selectedMarketKey] ? (
                <div className="skills-error">{rowError[selectedMarketKey]}</div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
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
