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

describe("NewIssueDialog type", () => {
  it("默认 work，选中 Bug 后提交带 type", async () => {
    const api = mockApi();
    const onCreated = vi.fn();
    render(
      <NewIssueDialog api={api} onCreated={onCreated} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId("new-issue-title"), {
      target: { value: "修登录" },
    });
    expect(screen.getByTestId("new-issue-type-work")).toBeChecked();
    fireEvent.click(screen.getByTestId("new-issue-type-bug"));
    fireEvent.click(screen.getByTestId("new-issue-submit"));
    await vi.waitFor(() => {
      expect(api.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "修登录",
          type: "bug",
        }),
      );
    });
  });
});
