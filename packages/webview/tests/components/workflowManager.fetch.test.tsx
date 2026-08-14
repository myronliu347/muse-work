/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WorkflowManager from "../../src/components/WorkflowManager";
import type { VsCodeApi } from "../../src/types";

vi.mock("../../src/styles/ConfigurationDialog.css", () => ({}));

describe("WorkflowManager fetch", () => {
  it("requests workflow runs when the dialog opens", () => {
    const vscode = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    } as unknown as VsCodeApi;

    render(
      <WorkflowManager runs={[]} vscode={vscode} onCancel={() => {}} />,
    );

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getWorkflowRuns",
    });
  });

  it("shows phase output for a fetched workflow run", () => {
    const vscode = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    } as unknown as VsCodeApi;

    render(
      <WorkflowManager
        runs={[
          {
            runId: "wf_abc12345",
            meta: { name: "Icap-ide-analysis", description: "审查" },
            status: "running",
            scriptPath: "/tmp/script.js",
            startTime: Date.now() - 60_000,
            phases: [
              {
                title: "Scan",
                agentCount: 2,
                tokens: 1200,
                elapsed: 1000,
                startTime: Date.now() - 60_000,
              },
            ],
            totalAgents: 2,
            totalTokens: 1200,
          },
        ]}
        vscode={vscode}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByText(/Icap-ide-analysis/));
    expect(screen.getByText("Phases:")).toBeInTheDocument();
    expect(screen.getByText("Scan")).toBeInTheDocument();
  });

  it("hides completed workflow runs", () => {
    const vscode = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    } as unknown as VsCodeApi;

    render(
      <WorkflowManager
        runs={[
          {
            runId: "wf_done",
            meta: { name: "already-done", description: "已完成" },
            status: "completed",
            scriptPath: "/tmp/done.js",
            startTime: Date.now() - 60_000,
            endTime: Date.now(),
            phases: [],
            totalAgents: 1,
            totalTokens: 10,
          },
          {
            runId: "wf_live",
            meta: { name: "still-running", description: "进行中" },
            status: "running",
            scriptPath: "/tmp/live.js",
            startTime: Date.now() - 10_000,
            phases: [],
            totalAgents: 2,
            totalTokens: 20,
          },
        ]}
        vscode={vscode}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText(/still-running/)).toBeInTheDocument();
    expect(screen.queryByText(/already-done/)).not.toBeInTheDocument();
  });

  it("opens the script path when clicked", () => {
    const vscode = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    } as unknown as VsCodeApi;
    const onOpenFile = vi.fn();

    render(
      <WorkflowManager
        runs={[
          {
            runId: "wf_abc12345",
            meta: { name: "Icap-ide-analysis", description: "审查" },
            status: "running",
            scriptPath: "/tmp/script.js",
            startTime: Date.now() - 60_000,
            phases: [],
            totalAgents: 1,
            totalTokens: 10,
          },
        ]}
        vscode={vscode}
        onCancel={() => {}}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByText(/Icap-ide-analysis/));
    fireEvent.click(screen.getByTestId("workflow-script-path"));
    expect(onOpenFile).toHaveBeenCalledWith("/tmp/script.js");
  });
});
