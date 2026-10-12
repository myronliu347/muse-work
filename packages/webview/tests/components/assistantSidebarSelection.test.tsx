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
          })}
        />
      </MuseTheme>,
    );
    establishSession();

    const row = screen.getByTestId("desktop-session-item-sess-mock");
    expect(row.className).toContain("desktop-session-item--current");

    await user.click(screen.getByTestId("desktop-assistant-menu"));

    expect(screen.getByTestId("desktop-assistant-menu").className).toContain(
      "active",
    );
    expect(row.className).not.toContain("desktop-session-item--current");
  });
});
