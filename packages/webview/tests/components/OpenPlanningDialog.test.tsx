/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { OpenPlanningDialog } from "../../src/components/issue/OpenPlanningDialog";
import type { MuseApiClient } from "../../src/muse/apiClient";

afterEach(() => {
  cleanup();
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
});
