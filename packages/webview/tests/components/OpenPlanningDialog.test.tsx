/** @vitest-environment jsdom */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import {
  OpenPlanningDialog,
  listBranchesViaHost,
  PICK_DIRECTORY_TIMEOUT_MS,
} from "../../src/components/issue/OpenPlanningDialog";
import type { MuseApiClient } from "../../src/muse/apiClient";

function renderDialog(ui: React.ReactElement) {
  return render(<Theme appearance="dark">{ui}</Theme>);
}

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mockApi(
  overrides: Partial<MuseApiClient> = {},
): MuseApiClient {
  return {
    openPlanningSession: vi.fn().mockResolvedValue({
      sessionId: "sess-plan",
      workdir: "/repo/demo",
    }),
    ...overrides,
  } as unknown as MuseApiClient;
}

describe("OpenPlanningDialog", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("confirm without worktree POSTs planning session and does not post desktopCreateWorktree", async () => {
    const api = mockApi();
    const postToHost = vi.fn();
    const pickDirectory = vi.fn().mockResolvedValue("/repo/demo");
    const onOpened = vi.fn();

    renderDialog(
      <OpenPlanningDialog
        issueId="issue-1"
        api={api}
        postToHost={postToHost}
        pickDirectory={pickDirectory}
        onOpened={onOpened}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "打开会话" })).toBeTruthy();
    expect(screen.getByText("工作模式（打开后不可更改）")).toBeTruthy();

    fireEvent.click(screen.getByTestId("open-planning-pick-directory"));
    await waitFor(() => {
      expect(screen.getByTestId("open-planning-workdir")).toHaveTextContent(
        "/repo/demo",
      );
    });

    expect(screen.getByTestId("open-planning-worktree")).not.toBeChecked();
    fireEvent.click(screen.getByTestId("open-planning-submit"));

    await waitFor(() => {
      expect(api.openPlanningSession).toHaveBeenCalledWith("issue-1", {
        workdir: "/repo/demo",
        worktreeEnabled: false,
        agentMode: "single",
      });
    });
    expect(postToHost).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopCreateWorktree" }),
    );
    expect(onOpened).toHaveBeenCalledWith({
      sessionId: "sess-plan",
      workdir: "/repo/demo",
    });
  });

  it("can open in 规划+执行 mode", async () => {
    const api = mockApi();
    const pickDirectory = vi.fn().mockResolvedValue("/repo/demo");

    renderDialog(
      <OpenPlanningDialog
        issueId="issue-1"
        api={api}
        postToHost={vi.fn()}
        pickDirectory={pickDirectory}
        onOpened={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("open-planning-pick-directory"));
    await waitFor(() => {
      expect(screen.getByTestId("open-planning-workdir")).toHaveTextContent(
        "/repo/demo",
      );
    });

    fireEvent.click(screen.getByTestId("open-planning-mode-split"));
    fireEvent.click(screen.getByTestId("open-planning-submit"));

    await waitFor(() => {
      expect(api.openPlanningSession).toHaveBeenCalledWith("issue-1", {
        workdir: "/repo/demo",
        worktreeEnabled: false,
        agentMode: "split",
      });
    });
  });

  it("while submitting, Escape does not call onCancel", async () => {
    let resolveOpen!: (v: { sessionId: string; workdir: string }) => void;
    const api = mockApi({
      openPlanningSession: vi.fn(
        () =>
          new Promise<{ sessionId: string; workdir: string }>((resolve) => {
            resolveOpen = resolve;
          }),
      ),
    });
    const onCancel = vi.fn();
    const pickDirectory = vi.fn().mockResolvedValue("/repo/demo");

    renderDialog(
      <OpenPlanningDialog
        issueId="issue-1"
        api={api}
        postToHost={vi.fn()}
        pickDirectory={pickDirectory}
        onOpened={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByTestId("open-planning-pick-directory"));
    await waitFor(() => {
      expect(screen.getByTestId("open-planning-workdir")).toHaveTextContent(
        "/repo/demo",
      );
    });

    fireEvent.click(screen.getByTestId("open-planning-submit"));
    await waitFor(() => {
      expect(api.openPlanningSession).toHaveBeenCalled();
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("open-planning-cancel")).toBeDisabled();

    await act(async () => {
      resolveOpen({ sessionId: "sess-plan", workdir: "/repo/demo" });
    });
  });

  it("worktree create timeout shows error and clears submitting", async () => {
    const api = mockApi();
    const postToHost = vi.fn();
    const pickDirectory = vi.fn().mockResolvedValue("/repo/demo");
    const onOpened = vi.fn();

    renderDialog(
      <OpenPlanningDialog
        issueId="issue-1"
        api={api}
        postToHost={postToHost}
        pickDirectory={pickDirectory}
        onOpened={onOpened}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("open-planning-pick-directory"));
    await waitFor(() => {
      expect(screen.getByTestId("open-planning-workdir")).toHaveTextContent(
        "/repo/demo",
      );
    });

    fireEvent.click(screen.getByTestId("open-planning-worktree"));

    vi.useFakeTimers();
    fireEvent.click(screen.getByTestId("open-planning-submit"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(postToHost).toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopCreateWorktree" }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PICK_DIRECTORY_TIMEOUT_MS);
    });

    expect(screen.getByTestId("open-planning-error")).toHaveTextContent(
      "创建 worktree 超时",
    );
    expect(screen.getByTestId("open-planning-submit")).not.toBeDisabled();
    expect(onOpened).not.toHaveBeenCalled();
    expect(api.openPlanningSession).not.toHaveBeenCalled();
  });

  it("unmount drops in-flight openPlanningSession so onOpened is not called", async () => {
    let resolveOpen!: (v: { sessionId: string; workdir: string }) => void;
    const api = mockApi({
      openPlanningSession: vi.fn(
        () =>
          new Promise<{ sessionId: string; workdir: string }>((resolve) => {
            resolveOpen = resolve;
          }),
      ),
    });
    const onOpened = vi.fn();
    const pickDirectory = vi.fn().mockResolvedValue("/repo/demo");

    const { unmount } = renderDialog(
      <OpenPlanningDialog
        issueId="issue-1"
        api={api}
        postToHost={vi.fn()}
        pickDirectory={pickDirectory}
        onOpened={onOpened}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("open-planning-pick-directory"));
    await waitFor(() => {
      expect(screen.getByTestId("open-planning-workdir")).toHaveTextContent(
        "/repo/demo",
      );
    });

    fireEvent.click(screen.getByTestId("open-planning-submit"));
    await waitFor(() => {
      expect(api.openPlanningSession).toHaveBeenCalled();
    });

    unmount();
    await act(async () => {
      resolveOpen({ sessionId: "sess-late", workdir: "/repo/demo" });
    });
    expect(onOpened).not.toHaveBeenCalled();
  });

  it("worktree 开启后基础分支从列表选择", async () => {
    const api = mockApi();
    const postToHost = vi.fn();
    const pickDirectory = vi.fn().mockResolvedValue("/repo/demo");
    const listBranches = vi.fn().mockResolvedValue({
      branches: ["main", "dev"],
      current: "main",
    });

    renderDialog(
      <OpenPlanningDialog
        issueId="issue-1"
        api={api}
        postToHost={postToHost}
        pickDirectory={pickDirectory}
        listBranches={listBranches}
        onOpened={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("open-planning-pick-directory"));
    await waitFor(() => {
      expect(screen.getByTestId("open-planning-workdir")).toHaveTextContent(
        "/repo/demo",
      );
    });
    await waitFor(() => {
      expect(listBranches).toHaveBeenCalledWith("/repo/demo");
    });

    fireEvent.click(screen.getByTestId("open-planning-worktree"));
    const trigger = await screen.findByTestId("open-planning-base-branch");
    expect(trigger).toHaveTextContent("main");
    expect(
      trigger.closest(".open-planning-branch-wrap")?.querySelector(
        ".codicon-git-branch",
      ),
    ).toBeTruthy();
    const user = userEvent.setup();
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "dev" }));

    fireEvent.click(screen.getByTestId("open-planning-submit"));
    await waitFor(() => {
      expect(postToHost).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopCreateWorktree",
          workdir: "/repo/demo",
          baseBranch: "dev",
        }),
      );
    });
  });

  it("listBranchesViaHost ignores pane polls and mismatched workdir", async () => {
    const postToHost = vi.fn();
    const pending = listBranchesViaHost(postToHost, "/repo/a");
    expect(postToHost).toHaveBeenCalledWith({
      command: "desktopListGitBranches",
      workdir: "/repo/a",
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "desktopGitBranches",
          paneId: "pane-1",
          workdir: "/repo/a",
          result: { branches: ["stolen"], current: "stolen" },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "desktopGitBranches",
          workdir: "/repo/b",
          result: { branches: ["nope"], current: "nope" },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "desktopGitBranches",
          workdir: "/repo/a",
          result: { branches: ["main", "dev"], current: "main" },
        },
      }),
    );

    await expect(pending).resolves.toEqual({
      branches: ["main", "dev"],
      current: "main",
    });
  });

  it("uses compact dialog type size matching confirm/settings", () => {
    const css = fs.readFileSync(
      path.join(__dirname, "../../src/styles/OpenPlanningDialog.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.open-planning-dialog\s*\{[^}]*font-size:\s*var\(--font-size-1\)/s,
    );
    expect(css).toMatch(
      /\.open-planning-workdir\s*\{[^}]*font-size:\s*var\(--font-size-1\)/s,
    );
    expect(css).toMatch(
      /\.open-planning-switch-title\s*\{[^}]*font-size:\s*var\(--font-size-1\)/s,
    );
    expect(css).toMatch(
      /\.open-planning-pick\s*\{[^}]*height:\s*28px/s,
    );
    expect(css).toMatch(
      /\.open-planning-branch-trigger\.rt-SelectTrigger\s*\{[^}]*height:\s*28px/s,
    );
    expect(css).not.toMatch(/::before/);
    expect(css).not.toMatch(/display:\s*contents/);
    expect(css).toMatch(
      /\[data-radix-popper-content-wrapper\]:has\(\.open-planning-branch-content\)\s*\{[^}]*z-index:\s*3100/s,
    );
  });

  it("lets the user pick a recent workdir without browsing", async () => {
    const api = mockApi();
    const pickDirectory = vi.fn();

    renderDialog(
      <OpenPlanningDialog
        issueId="issue-1"
        api={api}
        postToHost={vi.fn()}
        recentWorkdirs={["/Users/me/proj-a", "/Users/me/proj-b"]}
        pickDirectory={pickDirectory}
        onOpened={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByTestId("open-planning-recents")).toBeTruthy();
    fireEvent.click(screen.getByTestId("open-planning-recent-/Users/me/proj-b"));
    expect(pickDirectory).not.toHaveBeenCalled();
    expect(screen.getByTestId("open-planning-workdir")).toHaveTextContent(
      "/Users/me/proj-b",
    );

    fireEvent.click(screen.getByTestId("open-planning-submit"));
    await waitFor(() => {
      expect(api.openPlanningSession).toHaveBeenCalledWith("issue-1", {
        workdir: "/Users/me/proj-b",
        worktreeEnabled: false,
        agentMode: "single",
      });
    });
  });
});
