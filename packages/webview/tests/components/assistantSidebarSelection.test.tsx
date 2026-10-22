/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "../../src/components/ChatApp";
import { resetWebviewStores } from "../../src/stores";
import { MuseTheme } from "../../src/ui/theme";
import {
  createMockDesktopHost,
  createMockVscode,
  establishSession,
} from "../webview/test-utils";

describe("assistant sidebar selection", () => {
  it("drops the session highlight after opening Muse Bot", async () => {
    resetWebviewStores();
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <ChatApp
          vscode={createMockVscode()}
          host={createMockDesktopHost({
            sessionTree: [
              {
                host: "local",
                workdir: "recent",
                sessions: [
                  {
                    sessionId: "sess-mock",
                    title: "Yui spec",
                    lastActiveAt: Date.now(),
                    hasWorktree: false,
                    workdir: "/mock/sandbox",
                  },
                ],
              },
            ],
            issueGroups: [
              {
                issueId: "issue-1",
                title: "侧栏 Issue",
                priority: "p2",
                type: "research",
                status: "pending",
                items: [],
                sessions: [
                  {
                    sessionId: "plan-1",
                    title: "侧栏 Issue",
                    lastActiveAt: Date.now(),
                    hasWorktree: false,
                    workdir: "/mock/sandbox",
                  },
                ],
              },
            ],
          })}
        />
      </MuseTheme>,
    );
    establishSession();

    const assistant = screen.getByTestId("desktop-assistant-menu");
    expect(assistant).toHaveAttribute("aria-label", "Muse Bot");
    expect(assistant.className).toContain("active");
    expect(screen.queryByTestId("desktop-session-item-sess-mock")).toBeNull();
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();

    await user.click(screen.getByTestId("desktop-sessions-menu"));

    const row = screen.getByTestId("desktop-session-item-sess-mock");
    expect(row.className).toContain("desktop-session-item--current");
    expect(assistant.className).not.toContain("active");
    expect(screen.getByTestId("desktop-sessions-menu").className).toContain(
      "active",
    );
    const list = screen.getByTestId("desktop-session-list");
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
    expect(screen.queryByTestId("desktop-session-item-plan-1")).toBeNull();
    expect(list).not.toHaveTextContent("侧栏 Issue");

    await user.click(assistant);

    expect(assistant.className).toContain("active");
    expect(screen.queryByTestId("desktop-session-item-sess-mock")).toBeNull();
    expect(screen.queryByTestId("desktop-session-section-issues")).toBeNull();
  });
});
