import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/message/Message";
import { createMockVscode } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

describe("Message system-inject rendering", () => {
  it("renders injected message as system bubble with content stripped of marker", () => {
    const vscode = createMockVscode();
    const message = MockDataGenerator.createUserMessage(
      "<system-inject>【Todo/Task 进度同步】task 已完成，进入待审核。</system-inject>",
    );
    const { container } = render(<Message message={message} vscode={vscode} />);
    const bubble = container.querySelector(".system-inject-bubble");
    expect(bubble).toBeTruthy();
    expect(container.querySelector(".system-inject-head")?.textContent).toContain("系统");
    expect(bubble?.textContent).toContain("task 已完成");
    expect(bubble?.textContent).not.toContain("<system-inject>");
  });

  it("renders plain user message as a normal bubble (no system-inject style)", () => {
    const vscode = createMockVscode();
    const message = MockDataGenerator.createUserMessage("普通用户消息");
    const { container } = render(<Message message={message} vscode={vscode} />);
    expect(container.querySelector(".system-inject-bubble")).toBeNull();
    expect(container.querySelector(".message.user")).toBeTruthy();
  });
});
