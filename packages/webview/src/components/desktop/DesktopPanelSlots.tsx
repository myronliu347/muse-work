import { DesktopPanelDock, type DockToolTab } from "./DesktopPanelDock";
import { PreviewPane } from "../panels/PreviewPane";
import {
  DiffPane,
  type WorkspaceDiffFile,
} from "../panels/DiffPane";
import { FilePane } from "../panels/FilePane";
import { TerminalPane } from "../panels/TerminalPane";
import { PANEL_TAB_ORDER } from "../../muse/panelTabs";
import { botToolTermId, dockToolLabel, dockToolTitle } from "../../muse/dockTools";
import { clampDockWidth } from "../../muse/layout";
import type {
  ContentSearchState,
  DesktopPanelKind,
  DiffViewState,
  FileSidebarMode,
  FileTreeState,
  FileViewState,
  VsCodeApi,
} from "../../types";
import type { DockToolInstance, RemoteForwardRef } from "../../stores";

/** Desktop conversation-level panels: tab order in the shared dock. */
const PANEL_ORDER = PANEL_TAB_ORDER;

export interface DesktopPanelSlotsProps {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind | null;
  mounted: DesktopPanelKind[];
  disabledPanels: DesktopPanelKind[];
  fullscreen: boolean;
  widths: Record<DesktopPanelKind, number>;
  dockMaxWidth: number;
  onSelect: (kind: DesktopPanelKind) => void;
  onCloseTab: (kind: DesktopPanelKind) => void;
  onAddPanel: (kind: DesktopPanelKind) => void;
  onToggleDock: () => void;
  onToggleFullscreen: () => void;
  onWidthChange: (width: number) => void;
  // Panel slot payloads
  vscode: VsCodeApi;
  paneId?: string;
  isStreaming: boolean;
  sessionId?: string;
  workdir?: string;
  /** Branch this session's worktree was cut from. */
  baseBranch?: string;
  previewEpoch: number;
  previewUrl: string | null;
  currentForward: RemoteForwardRef | null;
  previewForwardError: string | null;
  onRemotePreviewRetry: () => void;
  onPreviewNavigate: (url: string) => void;
  onAddComment: (text: string) => void;
  diffView: DiffViewState | null;
  recentFiles: WorkspaceDiffFile[];
  onOpenFile: (path: string, startLine?: number, endLine?: number) => void;
  onOpenFilePinned: (path: string) => void;
  /** Soft re-read without activating the file panel. */
  onRefreshOpenFile: (path: string) => void;
  onSendMessage: (text: string) => void;
  fileView: FileViewState | null;
  fileTabs: FileViewState[];
  activeFilePath: string | null;
  onSelectFileTab: (path: string) => void;
  onCloseFileTab: (path: string) => void;
  onPinFileTab: (path: string) => void;
  fileTree: FileTreeState;
  onFileTreeChange: (next: FileTreeState) => void;
  fileSidebarMode: FileSidebarMode;
  onFileSidebarModeChange: (mode: FileSidebarMode) => void;
  contentSearch: ContentSearchState;
  onContentSearchChange: (next: ContentSearchState) => void;
  onOpenInPreview: (path: string) => void;
  onRevealInFinder: (path: string) => void;
  openPreviewHandler: (url: string) => void;
  /** 详情 stays mounted beside the kind panes and is the visible layer when set. */
  detailActive?: boolean;
  onSelectDetail?: () => void;
  detailTitle?: string;
  detail?: React.ReactNode;
  /** Bot-page terminals and browsers. Each tab keeps its own cwd or URL. */
  tools?: DockToolInstance[];
  activeToolId?: string | null;
  onSelectTool?: (id: string) => void;
  onCloseTool?: (id: string) => void;
  tabOrder?: readonly string[];
  onTabOrderChange?: (order: string[]) => void;
  onToolPreviewNavigate?: (id: string, url: string) => void;
  onToolPreviewRetry?: (id: string) => void;
}

/**
 * The shared dock with its panel slots (files/diff/terminal/preview). Each
 * mounted kind stays mounted when hidden; the preview slot remounts on
 * `previewEpoch` so a same-URL re-acquire actually reloads the webview.
 */
export const DesktopPanelSlots: React.FC<DesktopPanelSlotsProps> = ({
  checked,
  active,
  mounted,
  disabledPanels,
  fullscreen,
  widths,
  dockMaxWidth,
  onSelect,
  onCloseTab,
  onAddPanel,
  onToggleDock,
  onToggleFullscreen,
  onWidthChange,
  vscode,
  paneId,
  isStreaming,
  sessionId,
  workdir,
  baseBranch,
  previewEpoch,
  previewUrl,
  currentForward,
  previewForwardError,
  onRemotePreviewRetry,
  onPreviewNavigate,
  onAddComment,
  diffView,
  recentFiles,
  onOpenFile,
  onOpenFilePinned,
  onRefreshOpenFile,
  onSendMessage,
  fileView,
  fileTabs,
  activeFilePath,
  onSelectFileTab,
  onCloseFileTab,
  onPinFileTab,
  fileTree,
  onFileTreeChange,
  fileSidebarMode,
  onFileSidebarModeChange,
  contentSearch,
  onContentSearchChange,
  onOpenInPreview,
  onRevealInFinder,
  openPreviewHandler,
  detailActive = false,
  onSelectDetail,
  detailTitle,
  detail,
  tools = [],
  activeToolId = null,
  onSelectTool,
  onCloseTool,
  tabOrder,
  onTabOrderChange,
  onToolPreviewNavigate,
  onToolPreviewRetry,
}) => {
  const renderPanelSlot = (kind: DesktopPanelKind) => {
    const dockWidth = widths[active ?? kind] ?? 0;
    const common = {
      width: dockWidth,
      onWidthChange,
      maxWidth: dockMaxWidth,
      onClose: () => onCloseTab(kind),
    };

    if (kind === "preview") {
      return (
        <PreviewPane
          key={previewEpoch}
          url={previewUrl}
          originalUrl={currentForward?.originalUrl}
          onRetry={currentForward ? onRemotePreviewRetry : undefined}
          forwardError={previewForwardError}
          onNavigate={onPreviewNavigate}
          vscode={vscode}
          onAddComment={onAddComment}
          {...common}
        />
      );
    }
    if (kind === "diff") {
      return (
        <DiffPane
          vscode={vscode}
          paneId={paneId}
          visible={checked.includes("diff")}
          isStreaming={isStreaming}
          sessionId={sessionId}
          workdir={workdir}
          baseBranch={baseBranch}
          diffView={diffView}
          recentFiles={recentFiles}
          onOpenFile={onOpenFile}
          onAddComment={onAddComment}
          onSendMessage={onSendMessage}
          {...common}
        />
      );
    }
    if (kind === "file") {
      return (
        <FilePane
          fileView={fileView}
          workdir={workdir}
          vscode={vscode}
          fileTree={fileTree}
          onFileTreeChange={onFileTreeChange}
          fileSidebarMode={fileSidebarMode}
          onFileSidebarModeChange={onFileSidebarModeChange}
          contentSearch={contentSearch}
          onContentSearchChange={onContentSearchChange}
          onOpenFile={onOpenFile}
          onOpenFilePinned={onOpenFilePinned}
          onRefreshOpenFile={onRefreshOpenFile}
          onOpenInPreview={onOpenInPreview}
          onRevealInFinder={onRevealInFinder}
          isStreaming={isStreaming}
          visible={checked.includes("file")}
          {...common}
        />
      );
    }
    return (
      <TerminalPane
        vscode={vscode}
        paneId={paneId}
        visible={checked.includes("terminal")}
        workdir={workdir}
        onOpenPreview={openPreviewHandler}
        {...common}
      />
    );
  };

  return (
    <DesktopPanelDock
      checked={checked}
      active={active ?? "preview"}
      onSelect={onSelect}
      onCloseTab={onCloseTab}
      onAddPanel={onAddPanel}
      disabledPanels={disabledPanels}
      panelToggle={{
        onToggleDock,
      }}
      fullscreen={fullscreen}
      onToggleFullscreen={onToggleFullscreen}
      width={clampDockWidth(
        widths[active ?? "preview"] ?? 0,
        Math.max(0, dockMaxWidth),
      )}
      onWidthChange={onWidthChange}
      maxWidth={Math.max(0, dockMaxWidth)}
      fileTabs={fileTabs}
      activeFilePath={activeFilePath}
      onSelectFileTab={onSelectFileTab}
      onCloseFileTab={onCloseFileTab}
      onPinFileTab={onPinFileTab}
      detailActive={detailActive}
      onSelectDetail={onSelectDetail}
      detailTitle={detailTitle}
      detail={detail}
      toolTabs={tools.map(
        (tool): DockToolTab => ({
          id: tool.id,
          kind: tool.kind,
          label: dockToolLabel(tool, tools),
          title: dockToolTitle(tool),
        }),
      )}
      activeToolId={activeToolId}
      onSelectTool={onSelectTool}
      onCloseTool={onCloseTool}
      tabOrder={tabOrder}
      onTabOrderChange={onTabOrderChange}
    >
      {PANEL_ORDER.filter(
        (kind) => mounted.includes(kind) && !tools.some((tool) => tool.kind === kind),
      ).map((kind) => (
        <div
          key={kind}
          className="desktop-panel-slot"
          style={{
            display:
              checked.includes(kind) && kind === active
                ? undefined
                : "none",
          }}
        >
          {renderPanelSlot(kind)}
        </div>
      ))}
      {tools.map((tool) => {
        const showing = tool.id === activeToolId && tool.kind === active;
        const dockWidth = widths[active ?? tool.kind] ?? 0;
        const common = {
          width: dockWidth,
          onWidthChange,
          maxWidth: dockMaxWidth,
          onClose: () => onCloseTool?.(tool.id),
        };
        return (
          <div
            key={tool.id}
            className="desktop-panel-slot"
            style={{ display: showing ? undefined : "none" }}
          >
            {tool.kind === "terminal" ? (
              <TerminalPane
                vscode={vscode}
                paneId={paneId}
                visible
                workdir={tool.workdir}
                termId={botToolTermId(tool.id)}
                testIdScope={showing ? undefined : tool.id}
                onOpenPreview={openPreviewHandler}
                {...common}
              />
            ) : (
              <PreviewPane
                key={tool.epoch ?? 0}
                url={tool.previewUrl}
                originalUrl={tool.forward?.originalUrl}
                onRetry={
                  tool.forward ? () => onToolPreviewRetry?.(tool.id) : undefined
                }
                forwardError={tool.forwardError}
                onNavigate={(url) => onToolPreviewNavigate?.(tool.id, url)}
                vscode={vscode}
                onAddComment={onAddComment}
                testIdScope={showing ? undefined : tool.id}
                {...common}
              />
            )}
          </div>
        );
      })}
    </DesktopPanelDock>
  );
};
