export type HostToWebviewMessage = {
  command: string;
  [key: string]: unknown;
};

export const fixtures = {
  authStatusResponse: (
    isAuthenticated = true,
  ): HostToWebviewMessage => ({
    command: "authStatusResponse",
    isAuthenticated,
  }),

  desktopWorkdirState: (opts?: {
    workdir?: string;
    recentWorkdirs?: string[];
    host?: string;
  }): HostToWebviewMessage => ({
    command: "desktopWorkdirState",
    workdir: opts?.workdir,
    recentWorkdirs: opts?.recentWorkdirs ?? [],
    host: opts?.host ?? "local",
  }),

  setInitialState: (opts: {
    paneId?: string;
    workdir?: string;
    messages?: unknown[];
    session?: unknown;
    inputContent?: string;
    isAuthenticated?: boolean;
    [key: string]: unknown;
  }): HostToWebviewMessage => ({
    command: "setInitialState",
    ...opts,
  }),

  updateMessages: (
    messages: unknown[],
    opts?: { paneId?: string },
  ): HostToWebviewMessage => ({
    command: "updateMessages",
    messages,
    ...(opts?.paneId ? { paneId: opts.paneId } : {}),
  }),

  desktopTogglePanel: (panel: string): HostToWebviewMessage => ({
    command: "desktopTogglePanel",
    kind: panel,
  }),

  desktopPanes: (opts: {
    panes: unknown[];
    focusedPaneId?: string | null;
    rowHeights?: number[];
  }): HostToWebviewMessage => ({
    command: "desktopPanes",
    panes: opts.panes,
    focusedPaneId: opts.focusedPaneId ?? null,
    ...(opts.rowHeights ? { rowHeights: opts.rowHeights } : {}),
  }),

  desktopSessionTree: (opts: {
    groups: unknown[];
  }): HostToWebviewMessage => ({
    command: "desktopSessionTree",
    groups: opts.groups,
  }),

  /** Pin/recent sidebar model (Task 5 `buildSidebarModel`). */
  desktopSessionTreeRecent: (
    recent: unknown[],
    pinned: unknown[] = [],
  ): HostToWebviewMessage => ({
    command: "desktopSessionTree",
    groups: [
      { host: "local", workdir: "pin", sessions: pinned },
      { host: "local", workdir: "recent", sessions: recent },
    ],
  }),

  subagentConfigurationsResponse: (
    configurations: unknown[],
  ): HostToWebviewMessage => ({
    command: "subagentConfigurationsResponse",
    configurations,
  }),
};
