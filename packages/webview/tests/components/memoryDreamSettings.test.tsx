/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import { MemoryDreamSettings } from "../../src/components/settings/MemoryDreamSettings";
import type { MuseApiClient, MemoryDreamState } from "../../src/muse/apiClient";

function state(overrides: Partial<MemoryDreamState> = {}): MemoryDreamState {
  return {
    enabled: true,
    targets: [
      {
        id: "assistant",
        kind: "assistant",
        workdir: "/Users/me/assistant-chat",
        label: "助手记忆",
        enabled: true,
        mode: "auto",
        cadence: "daily",
        lastRunAt: Date.now(),
        lastStatus: "succeeded",
        lastSummary: { files: 513, orphans: 247, indexChars: 17437 },
        consecutiveFailures: 0,
      },
    ],
    runs: [
      {
        id: "run-1",
        targetId: "assistant",
        status: "succeeded",
        trigger: "manual",
        startedAt: Date.now(),
        draftReady: true,
        summary: { files: 400, orphans: 0, indexChars: 19000 },
      },
    ],
    ...overrides,
  };
}

function mockApi(next: MemoryDreamState) {
  return {
    getMemoryDream: vi.fn().mockResolvedValue(next),
    listMemoryDreamBackups: vi.fn().mockResolvedValue({ backups: [] }),
    setMemoryDreamEnabled: vi.fn().mockResolvedValue({ ok: true, enabled: false }),
    runMemoryDream: vi.fn().mockResolvedValue({ ok: true, started: true }),
    adoptMemoryDreamRun: vi.fn().mockResolvedValue({ ok: true }),
    getMemoryDreamReport: vi.fn().mockResolvedValue({
      report: "# 记忆整理报告\n\n- 文件数：400",
      durationMs: 407000,
      counts: { added: 1, changed: 1, removed: 1, conflicts: 0 },
      added: [
        {
          file: "merged_review.md",
          bytes: 4094,
          type: "feedback",
          name: "复核规则",
          description: "合并后的复核规则",
        },
      ],
      changed: [
        {
          file: "MEMORY.md",
          bytes: 5000,
          beforeBytes: 4600,
          type: "",
          name: "",
          description: "",
        },
      ],
      removed: [
        {
          file: "review_old.md",
          bytes: 1000,
          type: "feedback",
          name: "旧复核",
          description: "被合并的旧规则",
        },
      ],
    }),
    discardMemoryDreamRun: vi.fn().mockResolvedValue({ ok: true }),
    rollbackMemoryDream: vi.fn().mockResolvedValue({ ok: true }),
    reindexMemoryDream: vi.fn().mockResolvedValue({
      ok: true,
      hubs: 81,
      entries: 519,
    }),
  } as unknown as MuseApiClient & Record<string, ReturnType<typeof vi.fn>>;
}

function renderPanel(api: MuseApiClient) {
  return render(
    <Theme>
      <MemoryDreamSettings api={api} />
    </Theme>,
  );
}

describe("MemoryDreamSettings", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows the target stats and the manual run entry", async () => {
    const api = mockApi(state());
    renderPanel(api);
    await screen.findByText("助手记忆");
    expect(screen.getByText("513")).toBeTruthy();
    expect(screen.getByText("文件")).toBeTruthy();
    expect(screen.getByTestId("memory-dream-model")).toBeTruthy();
    expect(screen.getByRole("button", { name: "立即整理" })).toBeTruthy();
  });

  it("starts a manual run", async () => {
    const api = mockApi(state());
    renderPanel(api);
    await screen.findByRole("button", { name: "立即整理" });
    await userEvent.click(screen.getByRole("button", { name: "立即整理" }));
    await waitFor(() => expect(api.runMemoryDream).toHaveBeenCalledWith("assistant"));
  });

  it("adopts a finished draft after confirmation", async () => {
    const api = mockApi(state());
    renderPanel(api);
    await screen.findByRole("button", { name: "确认替换" });
    await userEvent.click(screen.getByRole("button", { name: "确认替换" }));
    await waitFor(() =>
      expect(api.adoptMemoryDreamRun).toHaveBeenCalledWith("run-1", false),
    );
  });

  it("does not adopt when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const api = mockApi(state());
    renderPanel(api);
    await screen.findByRole("button", { name: "确认替换" });
    await userEvent.click(screen.getByRole("button", { name: "确认替换" }));
    expect(api.adoptMemoryDreamRun).not.toHaveBeenCalled();
  });

  it("shows the draft diff and report before confirming", async () => {
    const api = mockApi(state());
    renderPanel(api);
    await screen.findByRole("button", { name: "查看草稿" });
    await userEvent.click(screen.getByRole("button", { name: "查看草稿" }));
    await waitFor(() =>
      expect(api.getMemoryDreamReport).toHaveBeenCalledWith("run-1"),
    );
    await screen.findByText("新增 1");
    expect(screen.getByText(/合并后的复核规则/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "查看详细报告" }));
    await screen.findByText(/记忆整理报告/);
    expect(
      screen.getByRole("button", { name: "收起详细报告" }),
    ).toBeTruthy();
  });

  it("offers a confirmed replace for a failed draft that only has warnings", async () => {
    const failed = state();
    failed.runs[0] = {
      ...failed.runs[0],
      status: "failed",
      error: "draft lint failed",
      lint: {
        ok: false,
        orphans: 213,
        overCap: 232,
        dangling: 0,
        indexChars: 19966,
        indexLines: 139,
      },
    };
    const api = mockApi(failed);
    renderPanel(api);
    await screen.findByText(/草稿校验：孤儿 213/);
    await userEvent.click(screen.getByRole("button", { name: "仍然替换" }));
    await waitFor(() =>
      expect(api.adoptMemoryDreamRun).toHaveBeenCalledWith("run-1", true),
    );
  });

  it("marks an adopted run instead of offering the buttons again", async () => {
    const adopted = state();
    adopted.runs[0] = { ...adopted.runs[0], adoptedAt: Date.now() };
    const api = mockApi(adopted);
    renderPanel(api);
    await screen.findByText("已替换");
    expect(screen.queryByRole("button", { name: "确认替换" })).toBeNull();
  });
});
