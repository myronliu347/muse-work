/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PanelToggleControl } from "../../src/components/panels/PanelToggleControl";
import { MuseTheme } from "../../src/ui/theme";

describe("PanelToggleControl", () => {
  it("toggles dock on click without opening a menu", () => {
    const onToggleDock = vi.fn();
    render(
      <MuseTheme>
        <PanelToggleControl onToggleDock={onToggleDock} />
      </MuseTheme>,
    );
    fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    expect(onToggleDock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("panel-toggle-menu")).toBeNull();
    expect(
      screen
        .getByTestId("panel-toggle-btn")
        .querySelector(".header-panel-toggle-caret"),
    ).toBeNull();
  });
});
