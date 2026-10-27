/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderChatApp } from "./test-utils";

function pressPanel(key: string) {
  const mac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
  fireEvent.keyDown(window, {
    key,
    metaKey: mac,
    ctrlKey: !mac,
    shiftKey: true,
  });
}

describe("panel focus shortcuts", () => {
  it("opens a panel and keeps it on the second press", async () => {
    renderChatApp();

    pressPanel("f");
    const fileTab = await screen.findByTestId("desktop-panel-tab-file");
    expect(fileTab.className).toContain("desktop-panel-tab--active");

    pressPanel("d");
    const diffTab = await screen.findByTestId("desktop-panel-tab-diff");
    expect(diffTab.className).toContain("desktop-panel-tab--active");
    expect(screen.getByTestId("desktop-panel-tab-file").className).not.toContain(
      "desktop-panel-tab--active",
    );

    pressPanel("f");
    expect(screen.getByTestId("desktop-panel-tab-file").className).toContain(
      "desktop-panel-tab--active",
    );
    expect(screen.getByTestId("desktop-panel-tab-diff")).toBeInTheDocument();
  });
});
