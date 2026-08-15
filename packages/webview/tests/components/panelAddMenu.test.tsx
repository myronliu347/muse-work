/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PanelAddMenu } from "../../src/components/panels/PanelAddMenu";

describe("PanelAddMenu", () => {
  it("lists only closed panels in 文件、终端、浏览器、变更 order", () => {
    render(
      <PanelAddMenu
        checked={["preview"]}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    );
    const items = screen.getAllByTestId(/panel-add-item-/);
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual([
      "panel-add-item-file",
      "panel-add-item-terminal",
      "panel-add-item-diff",
    ]);
    expect(screen.queryByTestId("panel-add-item-preview")).toBeNull();
  });

  it("adds a panel and closes the menu", () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<PanelAddMenu checked={[]} onAdd={onAdd} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("panel-add-item-file"));
    expect(onAdd).toHaveBeenCalledWith("file");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits disabled panels", () => {
    render(
      <PanelAddMenu
        checked={[]}
        disabled={["terminal"]}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId("panel-add-item-terminal")).toBeNull();
  });
});
