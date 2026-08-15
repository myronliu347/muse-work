/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelAddMenu } from "../../src/components/panels/PanelAddMenu";
import { MuseTheme } from "../../src/ui/theme";

function renderAddMenu(overrides?: {
  checked?: Array<"preview" | "diff" | "terminal" | "file">;
  disabled?: Array<"preview" | "diff" | "terminal" | "file">;
  onAdd?: (kind: "preview" | "diff" | "terminal" | "file") => void;
  defaultOpen?: boolean;
}) {
  const onAdd = overrides?.onAdd ?? vi.fn();
  render(
    <MuseTheme>
      <PanelAddMenu
        checked={overrides?.checked ?? []}
        disabled={overrides?.disabled}
        onAdd={onAdd}
        defaultOpen={overrides?.defaultOpen ?? true}
        trigger={
          <button type="button" data-testid="desktop-panel-add-btn">
            +
          </button>
        }
      />
    </MuseTheme>,
  );
  return { onAdd };
}

describe("PanelAddMenu", () => {
  it("lists only closed panels in 文件、终端、浏览器、变更 order", () => {
    renderAddMenu({ checked: ["preview"] });
    const items = screen.getAllByTestId(/panel-add-item-/);
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual([
      "panel-add-item-file",
      "panel-add-item-terminal",
      "panel-add-item-diff",
    ]);
    expect(screen.queryByTestId("panel-add-item-preview")).toBeNull();
  });

  it("adds a panel when an item is selected", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderAddMenu();
    await user.click(screen.getByTestId("panel-add-item-file"));
    expect(onAdd).toHaveBeenCalledWith("file");
  });

  it("omits disabled panels", () => {
    renderAddMenu({ disabled: ["terminal"] });
    expect(screen.queryByTestId("panel-add-item-terminal")).toBeNull();
  });
});
