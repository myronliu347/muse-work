/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { MuseTheme } from "../../src/ui/theme";
import { createMockVscode, sendCommand } from "../webview/test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

function renderDesktopApp() {
  const vscode = createMockVscode();
  render(
    <MuseTheme>
      <DesktopApp vscode={vscode} />
    </MuseTheme>,
  );
  return { vscode };
}

describe("Desktop draft NewSessionPage", () => {
  it("shows NewSessionPage without panel dock on draft", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", { recentWorkdirs: [] });
    sendCommand("setInitialState", {
      messages: [],
      isAuthenticated: true,
      session: {
        id: "__draft__",
        sessionType: "main",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });

    expect(screen.getByTestId("new-session-page")).toBeInTheDocument();
    expect(screen.getByTestId("message-input")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-muse-logo")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-panel-dock")).not.toBeInTheDocument();
  });

  it("leaves NewSessionPage after the session is bound", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
    sendCommand("setInitialState", {
      messages: [],
      isAuthenticated: true,
      session: {
        id: "__draft__",
        sessionType: "main",
        workdir: "/home/user/project",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    });
    expect(screen.getByTestId("new-session-page")).toBeInTheDocument();

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

    expect(screen.queryByTestId("new-session-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
  });

  it("does not show NewSessionPage after clearing a bound session", () => {
    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: "/home/user/project",
      recentWorkdirs: [],
    });
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

    expect(screen.queryByTestId("new-session-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desktop-workdir")).not.toBeInTheDocument();
  });
});
