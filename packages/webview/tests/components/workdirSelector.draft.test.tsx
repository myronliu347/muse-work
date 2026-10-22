/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { MuseTheme } from "../../src/ui/theme";
import { createMockVscode, sendCommand } from "../webview/test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

function renderDesktopApp() {
  const vscode = createMockVscode();
  const result = render(
    <MuseTheme>
      <DesktopApp vscode={vscode} />
    </MuseTheme>,
  );
  return { ...result, vscode };
}

function openSessions() {
  fireEvent.click(screen.getByTestId("desktop-sessions-menu"));
}

function readyDraft(opts?: { workdir?: string }) {
  sendCommand("desktopWorkdirState", {
    workdir: opts?.workdir,
    recentWorkdirs: [],
  });
  sendCommand("setInitialState", {
    messages: [],
    isAuthenticated: true,
    session: {
      id: "__draft__",
      sessionType: "main",
      workdir: opts?.workdir,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      latestTotalTokens: 0,
    },
  });
}

describe("Desktop workdir picker visibility", () => {
  it("shows the folder picker only on a draft / new session", () => {
    renderDesktopApp();
    readyDraft({ workdir: "/home/user/project" });
    openSessions();

    expect(screen.getByTestId("desktop-workdir")).toBeInTheDocument();
    expect(screen.getByTestId("input-workdir-row")).toBeInTheDocument();

    sendCommand("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("hi")],
      isAuthenticated: true,
      session: {
        id: "sess-1",
        sessionType: "main",
        workdir: "/home/user/project",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });

    expect(screen.queryByTestId("desktop-workdir")).not.toBeInTheDocument();
    expect(screen.queryByTestId("input-workdir-row")).not.toBeInTheDocument();
  });

  it("does not restore the folder picker after clearing a bound session", () => {
    renderDesktopApp();
    readyDraft({ workdir: "/home/user/project" });
    openSessions();
    sendCommand("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("hi")],
      isAuthenticated: true,
      session: {
        id: "sess-1",
        sessionType: "main",
        workdir: "/home/user/project",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });

    sendCommand("updateMessages", { messages: [] });

    expect(screen.queryByTestId("desktop-workdir")).not.toBeInTheDocument();
    expect(screen.queryByText("选择工作目录…")).not.toBeInTheDocument();
  });
});
