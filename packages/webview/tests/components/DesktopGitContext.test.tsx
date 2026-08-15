/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DesktopGitContext } from "../../src/components/desktop/DesktopGitContext";

describe("DesktopGitContext", () => {
  it("renders branch and worktree name", () => {
    render(
      <DesktopGitContext branch="worktree-foo" worktreeName="foo" />,
    );
    expect(screen.getByTestId("desktop-git-branch")).toHaveTextContent(
      "worktree-foo",
    );
    expect(screen.getByTestId("desktop-git-worktree")).toHaveTextContent("foo");
  });

  it("hides when empty", () => {
    const { container } = render(<DesktopGitContext />);
    expect(container).toBeEmptyDOMElement();
  });
});
