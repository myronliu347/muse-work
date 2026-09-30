import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueSessionHeader } from "../../src/components/issue/IssueSessionHeader";
import { PanelToggleControl } from "../../src/components/panels/PanelToggleControl";

describe("Issue session chrome", () => {
  it("renders title row actions slot for panel toggle", () => {
    render(
      <IssueSessionHeader
        title="修复登录校验"
        activeTab="planning"
        onTabChange={vi.fn()}
        showTabs={false}
        executionEnabled={false}
        actions={
          <div className="header-buttons">
            <PanelToggleControl onToggleDock={vi.fn()} />
          </div>
        }
      />,
    );
    expect(screen.getByTestId("issue-session-title")).toHaveTextContent(
      "修复登录校验",
    );
    expect(screen.getByTestId("panel-toggle-btn")).toBeInTheDocument();
  });
});
