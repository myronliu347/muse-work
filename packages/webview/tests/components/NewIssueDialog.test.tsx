/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NewIssueDialog } from "../../src/components/issue/NewIssueDialog";
import type { MuseApiClient } from "../../src/muse/apiClient";

afterEach(() => cleanup());

function mockApi(): MuseApiClient {
  return {
    createIssue: vi.fn().mockResolvedValue({ issue: { id: "i1" } }),
  } as unknown as MuseApiClient;
}

describe("NewIssueDialog tags", () => {
  it("Enter 把草稿收成 chip，提交时带 tags 数组", async () => {
    const api = mockApi();
    const onCreated = vi.fn();
    render(
      <NewIssueDialog api={api} onCreated={onCreated} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId("new-issue-title"), {
      target: { value: "修登录" },
    });
    const input = screen.getByTestId("new-issue-tags");
    fireEvent.change(input, { target: { value: "bug" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("new-issue-tag-bug")).toHaveTextContent("bug");
    fireEvent.change(input, { target: { value: "前端" } });
    fireEvent.keyDown(input, { key: "," });
    expect(screen.getByTestId("new-issue-tag-前端")).toBeTruthy();
    fireEvent.click(screen.getByTestId("new-issue-submit"));
    await vi.waitFor(() => {
      expect(api.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "修登录",
          tags: ["bug", "前端"],
        }),
      );
    });
  });
});
