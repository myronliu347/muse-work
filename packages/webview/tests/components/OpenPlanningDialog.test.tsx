/** @vitest-environment jsdom */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import {
  OpenPlanningDialog,
  PICK_DIRECTORY_TIMEOUT_MS,
} from "../../src/components/issue/OpenPlanningDialog";
import type { MuseApiClient } from "../../src/muse/apiClient";

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

    render(
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

    render(
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

    render(
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

    render(
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

    const { unmount } = render(
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

    render(
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
    const select = await screen.findByTestId("open-planning-base-branch");
    expect(select).toHaveValue("main");
    fireEvent.change(select, { target: { value: "dev" } });

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
  });
});
