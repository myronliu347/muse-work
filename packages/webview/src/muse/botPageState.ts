import type { PanelGroupState } from "../stores/panelGroupStore";
import type { DesktopPanelKind, FileViewState } from "../types";
import type { BotWorkspaceState, DockChrome, PanelSelection } from "../components/desktop/botWorkspace";
import { initialBotWorkspace } from "../components/desktop/botWorkspace";

export const BOT_PAGE_STATE_KEY = "muse.botPageState";

const ASSISTANT_KEY = "assistant";
const DOCKS: DockChrome[] = ["detail", "file", "terminal", "preview", "diff"];
const WIDTH_MIN = 320;
const WIDTH_MAX = 8000;

export interface BotPageToolSnap {
  id: string;
  kind: "terminal" | "preview";
  workdir?: string;
  previewUrl?: string | null;
  pageTitle?: string;
}

export interface BotPageDirectorySnap {
  checked: Array<"file" | "diff">;
  active: "file" | "diff" | null;
  fileTabs: BotPageFileTabSnap[];
  activeFilePath: string | null;
}

export interface BotPageFileTabSnap {
  path: string;
  host: string;
  pinned?: boolean;
}

export interface BotPageAssistantSnap {
  dockColumnOpen: boolean;
  widths: Record<DesktopPanelKind, number>;
  tabOrder: string[];
  activeToolId: string | null;
  tools: BotPageToolSnap[];
  /** File previews opened on the bot page. Absent in older snapshots. */
  fileTabs?: BotPageFileTabSnap[];
  activeFilePath?: string | null;
}

export interface BotPageSnapshot {
  version: 1;
  workspace: BotWorkspaceState | null;
  assistant: BotPageAssistantSnap | null;
  directories: Record<string, BotPageDirectorySnap>;
}

export interface RestoredFileLoad {
  workdir: string;
  path: string;
  host: string;
}

let suspended = false;
let pendingFileLoads: RestoredFileLoad[] = [];
let consumed = false;

function persistenceEnabled(): boolean {
  try {
    return process.env.NODE_ENV !== "test";
  } catch {
    return true;
  }
}

function emptySnapshot(): BotPageSnapshot {
  return { version: 1, workspace: null, assistant: null, directories: {} };
}

function readStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(BOT_PAGE_STATE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(raw: string): void {
  try {
    globalThis.localStorage?.setItem(BOT_PAGE_STATE_KEY, raw);
  } catch {
    /* private mode / blocked storage */
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, limit);
}

function finiteWidth(value: unknown, fallback: number): number {
  const width = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(width)) return fallback;
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, width));
}

function parsePanel(value: unknown): PanelSelection {
  if (!isRecord(value)) return { kind: "none" };
  if (value.kind === "issue" && typeof value.issueId === "string" && value.issueId) {
    return { kind: "issue", issueId: value.issueId };
  }
  if (value.kind === "queue" && typeof value.id === "string" && value.id) {
    return { kind: "queue", id: value.id };
  }
  return { kind: "none" };
}

function parseDock(value: unknown): DockChrome {
  return DOCKS.find((dock) => dock === value) ?? "detail";
}

function parseDocks(value: unknown, openIssueIds: readonly string[]): Record<string, DockChrome> {
  if (!isRecord(value)) return {};
  const allowed = new Set<string>(["bot", ...openIssueIds]);
  const docks: Record<string, DockChrome> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    const dock = DOCKS.find((entry) => entry === item);
    if (dock) docks[key] = dock;
  }
  return docks;
}

function parseWorkspace(value: unknown): BotWorkspaceState | null {
  if (!isRecord(value)) return null;
  const openIssueIds = stringList(value.openIssueIds, 30);
  const active = typeof value.active === "string" && value.active ? value.active : "bot";
  const lastIssueId = typeof value.lastIssueId === "string" && value.lastIssueId ? value.lastIssueId : null;
  const dock = parseDock(value.dock);
  const docks = parseDocks(value.docks, openIssueIds);
  if (!docks[active]) docks[active] = dock;
  return {
    active: active === "bot" || openIssueIds.includes(active) ? active : "bot",
    openIssueIds,
    panel: parsePanel(value.panel),
    dock,
    docks,
    lastIssueId,
  };
}

function parseTools(value: unknown): BotPageToolSnap[] {
  if (!Array.isArray(value)) return [];
  const tools: BotPageToolSnap[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || !item.id) continue;
    if (item.kind !== "terminal" && item.kind !== "preview") continue;
    if (item.kind === "terminal" && (typeof item.workdir !== "string" || !item.workdir.trim())) {
      continue;
    }
    const tool: BotPageToolSnap = { id: item.id, kind: item.kind };
    if (typeof item.workdir === "string" && item.workdir.trim()) tool.workdir = item.workdir;
    if (typeof item.previewUrl === "string") tool.previewUrl = item.previewUrl;
    else if (item.previewUrl === null) tool.previewUrl = null;
    if (typeof item.pageTitle === "string" && item.pageTitle.trim()) {
      tool.pageTitle = item.pageTitle.trim().slice(0, 120);
    }
    tools.push(tool);
    if (tools.length >= 30) break;
  }
  return tools;
}

function parseFileTabSnaps(value: unknown): BotPageFileTabSnap[] {
  if (!Array.isArray(value)) return [];
  const fileTabs: BotPageFileTabSnap[] = [];
  for (const tab of value) {
    if (!isRecord(tab) || typeof tab.path !== "string" || !tab.path) continue;
    fileTabs.push({
      path: tab.path,
      host: typeof tab.host === "string" && tab.host ? tab.host : "local",
      ...(tab.pinned === true ? { pinned: true } : {}),
    });
    if (fileTabs.length >= 40) break;
  }
  return fileTabs;
}

function parseAssistant(value: unknown): BotPageAssistantSnap | null {
  if (!isRecord(value)) return null;
  const widths = isRecord(value.widths) ? value.widths : {};
  const tools = parseTools(value.tools);
  const activeToolId =
    typeof value.activeToolId === "string" && tools.some((tool) => tool.id === value.activeToolId)
      ? value.activeToolId
      : (tools.at(-1)?.id ?? null);
  const fileTabs = parseFileTabSnaps(value.fileTabs);
  const activeFilePath =
    typeof value.activeFilePath === "string" && fileTabs.some((tab) => tab.path === value.activeFilePath)
      ? value.activeFilePath
      : (fileTabs[0]?.path ?? null);
  return {
    dockColumnOpen: value.dockColumnOpen === true,
    widths: {
      preview: finiteWidth(widths.preview, 420),
      diff: finiteWidth(widths.diff, 420),
      terminal: finiteWidth(widths.terminal, 420),
      file: finiteWidth(widths.file, 420),
    },
    tabOrder: stringList(value.tabOrder, 80),
    activeToolId,
    tools,
    ...(fileTabs.length > 0 ? { fileTabs, activeFilePath } : {}),
  };
}

function parseDirectory(value: unknown): BotPageDirectorySnap | null {
  if (!isRecord(value)) return null;
  const checked = (Array.isArray(value.checked) ? value.checked : []).filter(
    (kind): kind is "file" | "diff" => kind === "file" || kind === "diff",
  );
  const fileTabs = parseFileTabSnaps(value.fileTabs);
  if (checked.length === 0 && fileTabs.length === 0) return null;
  const nextChecked = Array.from(
    new Set([...(fileTabs.length > 0 ? ["file" as const] : []), ...checked]),
  );
  const requested = value.active === "file" || value.active === "diff" ? value.active : null;
  const activeFilePath =
    typeof value.activeFilePath === "string" && fileTabs.some((tab) => tab.path === value.activeFilePath)
      ? value.activeFilePath
      : (fileTabs[0]?.path ?? null);
  return {
    checked: nextChecked,
    active: requested && nextChecked.includes(requested) ? requested : (nextChecked[0] ?? null),
    fileTabs,
    activeFilePath,
  };
}

export function loadBotPageSnapshot(): BotPageSnapshot | null {
  const raw = readStorage();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    const directories: Record<string, BotPageDirectorySnap> = {};
    if (isRecord(parsed.directories)) {
      for (const [key, value] of Object.entries(parsed.directories)) {
        if (!key || key === ASSISTANT_KEY || isSkippedGroupKey(key)) continue;
        const directory = parseDirectory(value);
        if (directory) directories[key] = directory;
        if (Object.keys(directories).length >= 40) break;
      }
    }
    return {
      version: 1,
      workspace: parseWorkspace(parsed.workspace),
      assistant: parseAssistant(parsed.assistant),
      directories,
    };
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: BotPageSnapshot): void {
  if (suspended) return;
  writeStorage(JSON.stringify(snapshot));
}

export function saveBotWorkspace(state: BotWorkspaceState): void {
  if (!persistenceEnabled() || suspended) return;
  const current = loadBotPageSnapshot() ?? emptySnapshot();
  current.workspace = {
    active: state.active,
    openIssueIds: state.openIssueIds.slice(0, 30),
    panel: state.panel,
    dock: state.dock,
    docks: state.docks,
    lastIssueId: state.lastIssueId,
  };
  writeSnapshot(current);
}

export function captureBotPanels(groups: Record<string, PanelGroupState>): {
  assistant: BotPageAssistantSnap | null;
  directories: Record<string, BotPageDirectorySnap>;
} {
  return {
    assistant: serializeAssistant(groups[ASSISTANT_KEY]),
    directories: serializeDirectories(groups),
  };
}

export function rememberBotPanelGroups(groups: Record<string, PanelGroupState>): void {
  if (!persistenceEnabled() || suspended) return;
  const current = loadBotPageSnapshot() ?? emptySnapshot();
  const captured = captureBotPanels(groups);
  current.assistant = captured.assistant;
  current.directories = captured.directories;
  writeSnapshot(current);
}

function serializeAssistant(group: PanelGroupState | undefined): BotPageAssistantSnap | null {
  if (!group) return null;
  const tools = (group.tools ?? [])
    .filter((tool) => tool.kind === "preview" || (tool.kind === "terminal" && Boolean(tool.workdir?.trim())))
    .slice(0, 30)
    .map((tool) => ({
      id: tool.id,
      kind: tool.kind,
      ...(tool.workdir ? { workdir: tool.workdir } : {}),
      ...(tool.previewUrl !== undefined ? { previewUrl: tool.previewUrl } : {}),
      ...(tool.pageTitle?.trim() ? { pageTitle: tool.pageTitle.trim().slice(0, 120) } : {}),
    }));
  const fileTabs = (group.fileTabs ?? [])
    .filter((tab) => typeof tab.path === "string" && tab.path)
    .slice(0, 40)
    .map((tab) => ({
      path: tab.path,
      host: tab.host || "local",
      ...(tab.pinned ? { pinned: true } : {}),
    }));
  const widths = group.widths;
  return {
    dockColumnOpen: group.dockColumnOpen === true,
    widths: {
      preview: finiteWidth(widths?.preview, 420),
      diff: finiteWidth(widths?.diff, 420),
      terminal: finiteWidth(widths?.terminal, 420),
      file: finiteWidth(widths?.file, 420),
    },
    tabOrder: (group.tabOrder ?? []).slice(0, 80),
    activeToolId:
      group.activeToolId && tools.some((tool) => tool.id === group.activeToolId)
        ? group.activeToolId
        : (tools.at(-1)?.id ?? null),
    tools,
    ...(fileTabs.length > 0
      ? {
          fileTabs,
          activeFilePath:
            group.activeFilePath && fileTabs.some((tab) => tab.path === group.activeFilePath)
              ? group.activeFilePath
              : (fileTabs[0]?.path ?? null),
        }
      : {}),
  };
}

function serializeDirectories(
  groups: Record<string, PanelGroupState>,
): Record<string, BotPageDirectorySnap> {
  const directories: Record<string, BotPageDirectorySnap> = {};
  for (const [key, group] of Object.entries(groups)) {
    if (!key || key === ASSISTANT_KEY || isSkippedGroupKey(key)) continue;
    const snap = directoryFromGroup(group);
    if (snap) directories[key] = snap;
    if (Object.keys(directories).length >= 40) break;
  }
  return directories;
}

function directoryFromGroup(group: PanelGroupState): BotPageDirectorySnap | null {
  const checked = (group.checked ?? []).filter(
    (kind): kind is "file" | "diff" => kind === "file" || kind === "diff",
  );
  const fileTabs = (group.fileTabs ?? [])
    .filter((tab) => typeof tab.path === "string" && tab.path)
    .slice(0, 40)
    .map((tab) => ({
      path: tab.path,
      host: tab.host || "local",
      ...(tab.pinned ? { pinned: true } : {}),
    }));
  if (checked.length === 0 && fileTabs.length === 0) return null;
  const withFile = fileTabs.length > 0 && !checked.includes("file") ? [...checked, "file" as const] : checked;
  const active = group.active === "file" || group.active === "diff" ? group.active : null;
  return {
    checked: withFile,
    active: active && withFile.includes(active) ? active : (withFile[0] ?? null),
    fileTabs,
    activeFilePath:
      group.activeFilePath && fileTabs.some((tab) => tab.path === group.activeFilePath)
        ? group.activeFilePath
        : (fileTabs[0]?.path ?? null),
  };
}

export function restoredBotPanelGroups(): Record<string, Partial<PanelGroupState>> | null {
  if (!persistenceEnabled() || consumed) return null;
  const snapshot = loadBotPageSnapshot();
  if (!snapshot) return null;
  consumed = true;
  return panelPatchesFromSnapshot(snapshot);
}

export function panelPatchesFromSnapshot(
  snapshot: BotPageSnapshot,
): Record<string, Partial<PanelGroupState>> {
  const groups: Record<string, Partial<PanelGroupState>> = {};
  pendingFileLoads = [];
  if (snapshot.assistant) {
    const assistant = snapshot.assistant;
    groups[ASSISTANT_KEY] = {
      dockColumnOpen: assistant.dockColumnOpen,
      widths: assistant.widths,
      tabOrder: assistant.tabOrder,
      activeToolId: assistant.activeToolId,
      tools: assistant.tools.map((tool) => ({
        id: tool.id,
        kind: tool.kind,
        workdir: tool.workdir,
        previewUrl: tool.previewUrl ?? null,
        pageTitle: tool.pageTitle ?? null,
        forward: null,
        forwardError: null,
        epoch: 0,
      })),
    };
    const assistantTabs = assistant.fileTabs ?? [];
    if (assistantTabs.length > 0) {
      const fileTabs: FileViewState[] = assistantTabs.map((tab) => ({
        path: tab.path,
        host: tab.host,
        loading: true,
        ...(tab.pinned ? { pinned: true } : {}),
      }));
      groups[ASSISTANT_KEY] = {
        ...groups[ASSISTANT_KEY],
        fileTabs,
        activeFilePath:
          assistant.activeFilePath && fileTabs.some((tab) => tab.path === assistant.activeFilePath)
            ? assistant.activeFilePath
            : (fileTabs[0]?.path ?? null),
        checked: ["file"],
        mounted: ["file"],
      };
      for (const tab of assistantTabs) {
        pendingFileLoads.push({ workdir: ASSISTANT_KEY, path: tab.path, host: tab.host });
      }
    }
  }
  for (const [workdir, directory] of Object.entries(snapshot.directories)) {
    const fileTabs: FileViewState[] = directory.fileTabs.map((tab) => ({
      path: tab.path,
      host: tab.host,
      loading: true,
      ...(tab.pinned ? { pinned: true } : {}),
    }));
    groups[workdir] = {
      checked: directory.checked,
      mounted: directory.checked,
      active: directory.active,
      fileTabs,
      activeFilePath: directory.activeFilePath,
    };
    for (const tab of directory.fileTabs) {
      pendingFileLoads.push({ workdir, path: tab.path, host: tab.host });
    }
  }
  return groups;
}

export function restoredDockAlreadyOpen(): boolean {
  if (!persistenceEnabled()) return false;
  return loadBotPageSnapshot()?.assistant?.dockColumnOpen === true;
}

export function takeRestoredFileLoads(): RestoredFileLoad[] {
  const loads = pendingFileLoads;
  pendingFileLoads = [];
  return loads;
}

export function pruneBotWorkspace(
  state: BotWorkspaceState,
  issueIds: readonly string[],
): BotWorkspaceState {
  if (issueIds.length === 0) return state;
  const known = new Set(issueIds);
  const openIssueIds = state.openIssueIds.filter((id) => known.has(id));
  const panel =
    state.panel.kind === "issue" && !known.has(state.panel.issueId)
      ? { kind: "none" as const }
      : state.panel;
  const lastIssueId = state.lastIssueId && known.has(state.lastIssueId) ? state.lastIssueId : null;
  const active = state.active === "bot" || openIssueIds.includes(state.active) ? state.active : "bot";
  const docks: Record<string, DockChrome> = {};
  for (const [key, dock] of Object.entries(state.docks ?? {})) {
    if (key === "bot" || openIssueIds.includes(key)) docks[key] = dock;
  }
  const docksUnchanged =
    Object.keys(docks).length === Object.keys(state.docks ?? {}).length &&
    Object.entries(docks).every(([key, dock]) => state.docks?.[key] === dock);
  if (
    active === state.active &&
    lastIssueId === state.lastIssueId &&
    panel === state.panel &&
    openIssueIds.length === state.openIssueIds.length &&
    docksUnchanged
  ) {
    return state;
  }
  const dock = docks[active] ?? (active === state.active ? state.dock : "detail");
  return { ...state, active, openIssueIds, panel, lastIssueId, dock, docks };
}

export function readInitialBotWorkspace(
  firstIssueId: string | null,
  issueIds?: readonly string[],
): BotWorkspaceState {
  const saved = loadBotPageSnapshot()?.workspace;
  if (!saved) return initialBotWorkspace(firstIssueId);
  return pruneBotWorkspace(saved, issueIds ?? []);
}

export function resetBotPagePersistence(): void {
  suspended = true;
  consumed = false;
  pendingFileLoads = [];
  try {
    globalThis.localStorage?.removeItem(BOT_PAGE_STATE_KEY);
  } catch {
    /* ignore */
  }
  suspended = false;
}

export function botPagePersistenceEnabled(): boolean {
  return persistenceEnabled();
}

function isSkippedGroupKey(key: string): boolean {
  return key === "__draft__" || key.startsWith("new:");
}
