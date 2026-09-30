/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiddleEllipsisText } from "../../src/components/shared/MiddleEllipsisText";

describe("MiddleEllipsisText", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("renders middle-ellipsis path and exposes full path as title", () => {
    const path =
      "apps/spec-server/docs/data-model-spec/plan/2026-07-15-cross-domain-merge-overhead-fix/changelog.md";
    render(
      <MiddleEllipsisText text={path} className="quick-open-item-path" />,
    );
    const el = screen.getByTitle(path);
    expect(el.className).toContain("quick-open-item-path");
    expect(el.textContent).toContain("…");
    expect(el.textContent).toMatch(/changelog\.md$/);
  });
});
