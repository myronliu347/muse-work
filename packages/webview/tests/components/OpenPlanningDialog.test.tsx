/** @vitest-environment jsdom */
import React from "react";
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
});
