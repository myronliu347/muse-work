/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import BackgroundTaskManager from "../../src/components/settings/BackgroundTaskManager";
import type { VsCodeApi } from "../../src/types";

vi.mock("../../src/styles/ConfigurationDialog.css", () => ({}));

describe("BackgroundTaskManager fetch", () => {
  it("requests background tasks when the dialog opens", () => {
    const vscode = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    } as unknown as VsCodeApi;

    render(
      <BackgroundTaskManager
        tasks={[]}
        vscode={vscode}
        onClose={() => {}}
      />,
    );

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getBackgroundTasks",
    });
  });

  it("renders nested backgroundTaskOutput stdout after selecting a task", async () => {
    const vscode = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    } as unknown as VsCodeApi;

    render(
      <BackgroundTaskManager
        tasks={[
          {
            id: "bt-1",
            type: "shell",
            status: "running",
            startTime: Date.now(),
            command: "npm run build",
          },
        ]}
        vscode={vscode}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("[bt-1] shell"));

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getBackgroundTaskOutput",
      taskId: "bt-1",
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "backgroundTaskOutput",
            taskId: "bt-1",
            output: {
              stdout: "built in 3.2s",
              stderr: "",
              status: "running",
              type: "shell",
            },
          },
        }),
      );
    });

    expect(screen.getByText(/built in 3.2s/)).toBeInTheDocument();
  });

  it("hides completed background tasks", () => {
    const vscode = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    } as unknown as VsCodeApi;

    render(
      <BackgroundTaskManager
        tasks={[
          {
            id: "bt-done",
            type: "shell",
            status: "completed",
            startTime: Date.now() - 60_000,
            command: "npm test",
          },
          {
            id: "bt-live",
            type: "shell",
            status: "running",
            startTime: Date.now(),
            command: "npm run build",
          },
        ]}
        vscode={vscode}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("[bt-live] shell")).toBeInTheDocument();
    expect(screen.queryByText("[bt-done] shell")).not.toBeInTheDocument();
    expect(screen.queryByText("npm test")).not.toBeInTheDocument();
  });
});
