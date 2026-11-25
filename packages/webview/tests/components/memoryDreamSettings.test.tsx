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
        learning: { rules: 1, skills: 1 },
      },
    ],
    ...overrides,
  };
}

function mockApi(next: MemoryDreamState) {
  return {
    getMemoryDream: vi.fn().mockResolvedValue(next),
    getMemoryDreamLearning: vi.fn().mockResolvedValue({
      workdir: "/Users/me/assistant-chat",
      memory: [
        { name: "MEMORY.md", content: "# Memory\n\n- [a](a.md) — a" },
        {
          name: "feedback_x.md",
          content:
            "---\nname: 反馈事项\ndescription: 一条反馈记忆\ntype: feedback\n---\n\n正文内容。",
        },
      ],
      rules: [
        {
          name: "report-timing",
          description: "只在需要拍板时主动发消息。",
          content: "只有失败、卡住或需要用户拍板时才主动发消息。",
        },
      ],
      skills: [
        {
          name: "progress-review",
          description: "当用户要求汇总进展时使用。",
          content: "---\nname: progress-review\ndescription: x\n---\n\n## 步骤\n1. 做\n",
        },
      ],
    }),
    listMemoryDreamBackups: vi.fn().mockResolvedValue({ backups: [] }),
    setMemoryDreamEnabled: vi.fn().mockResolvedValue({ ok: true, enabled: false }),
    runMemoryDream: vi.fn().mockResolvedValue({ ok: true, started: true }),
    adoptMemoryDreamRun: vi.fn().mockResolvedValue({ ok: true }),
    resetMemoryDreamLearning: vi.fn().mockResolvedValue({ ok: true, removed: true }),
    adoptMemoryDreamSkill: vi.fn().mockResolvedValue({ ok: true }),
    adoptMemoryDreamRule: vi.fn().mockResolvedValue({ ok: true, effective: "next-session" }),
    rejectMemoryDreamDraft: vi.fn().mockResolvedValue({ ok: true }),
    getMemoryDreamReport: vi.fn().mockResolvedValue({
      report: "# 记忆整理报告\n\n- 文件数：400",
      durationMs: 407000,
      skills: [],
      rules: [],
      counts: { added: 1, changed: 1, removed: 1, conflicts: 0, skills: 0, rules: 0 },
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
  } as unknown as MuseApiClient & Record<string, ReturnType<typeof vi.fn>>;
}

function renderPanel(api: MuseApiClient) {
  return render(
    <Theme>
      <MemoryDreamSettings api={api} />
    </Theme>,
  );
}

async function confirmDialog(confirm = true) {
  await userEvent.click(
    await screen.findByTestId(
      confirm ? "confirm-dialog-confirm" : "confirm-dialog-cancel",
    ),
  );
}

describe("MemoryDreamSettings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the target stats and the manual run entry", async () => {
    const api = mockApi(state());
    renderPanel(api);
    await screen.findByText("助手记忆");
    expect(screen.getByText("513")).toBeTruthy();
    expect(screen.getByText("文件")).toBeTruthy();
    expect(screen.getByTestId("memory-dream-model")).toBeTruthy();
    expect(screen.getByRole("button", { name: "立即整理" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "处理规则/技能 2" }),
    ).toBeTruthy();
  });

  it("clears the learning cursor after two confirmations", async () => {
    const api = mockApi(state());
    renderPanel(api);
    await screen.findByRole("button", { name: "清空游标" });
    await userEvent.click(screen.getByRole("button", { name: "清空游标" }));
    await confirmDialog();
    await confirmDialog();
    await waitFor(() =>
      expect(api.resetMemoryDreamLearning).toHaveBeenCalledWith("assistant"),
    );
  });

  it("opens the knowledge library in a large dialog", async () => {
    const api = mockApi(state());
    renderPanel(api);
    await userEvent.click(
      await screen.findByRole("button", { name: "查看知识库" }),
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText("反馈事项").length).toBeGreaterThan(0);
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
    await confirmDialog();
    await waitFor(() =>
      expect(api.adoptMemoryDreamRun).toHaveBeenCalledWith("run-1", false),
    );
  });

  it("does not adopt when the confirmation is declined", async () => {
    const api = mockApi(state());
    renderPanel(api);
    await screen.findByRole("button", { name: "确认替换" });
    await userEvent.click(screen.getByRole("button", { name: "确认替换" }));
    await confirmDialog(false);
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

  it("adopts an assistant skill draft after confirmation", async () => {
    const api = mockApi(state());
    const report = await (api.getMemoryDreamReport as ReturnType<typeof vi.fn>)();
    (report as { skills: unknown[] }).skills = [
      {
        name: "progress-review",
        description: "当用户要求汇总进展时使用。",
        action: "create",
        evidence: [{ day: "2026-11-24" }],
        confidence: 0.8,
        occurrenceDays: 2,
        content: "---\nname: progress-review\ndescription: x\n---\n\n## 步骤\n1. 做\n",
        exists: false,
        adopted: false,
        lint: { ok: true, issues: [] },
      },
    ];
    (report as { counts: { skills: number } }).counts.skills = 1;
    renderPanel(api);
    await screen.findByRole("button", { name: "查看草稿" });
    await userEvent.click(screen.getByRole("button", { name: "查看草稿" }));
    await screen.findByText("progress-review");
    await userEvent.click(screen.getByRole("button", { name: "采纳" }));
    await confirmDialog();
    await waitFor(() =>
      expect(api.adoptMemoryDreamSkill).toHaveBeenCalledWith(
        "run-1",
        "progress-review",
      ),
    );
  });

  it("adopts an assistant rule draft after confirmation", async () => {
    const api = mockApi(state());
    const report = await (api.getMemoryDreamReport as ReturnType<typeof vi.fn>)();
    (report as { rules: unknown[] }).rules = [
      {
        name: "report-timing",
        description: "只在需要拍板时主动发消息。",
        text: "只有失败、卡住或需要用户拍板时才主动发消息。",
        evidence: [{ day: "2026-11-20" }],
        confidence: 0.8,
        occurrenceDays: 2,
        exists: false,
        adopted: false,
        lint: { ok: true, issues: [] },
      },
    ];
    (report as { counts: { rules: number } }).counts.rules = 1;
    renderPanel(api);
    await screen.findByRole("button", { name: "查看草稿" });
    await userEvent.click(screen.getByRole("button", { name: "查看草稿" }));
    await screen.findByText("report-timing");
    await userEvent.click(screen.getByRole("button", { name: "采纳" }));
    await confirmDialog();
    await waitFor(() =>
      expect(api.adoptMemoryDreamRule).toHaveBeenCalledWith(
        "run-1",
        "report-timing",
      ),
    );
  });

  it("adopts all safe rule and skill drafts in one action", async () => {
    const api = mockApi(state());
    const report = await (api.getMemoryDreamReport as ReturnType<typeof vi.fn>)();
    (report as { rules: unknown[] }).rules = [
      {
        name: "report-timing",
        description: "只在需要拍板时主动发消息。",
        text: "只有失败、卡住或需要用户拍板时才主动发消息。",
        evidence: [{ day: "2026-11-20" }],
        confidence: 0.8,
        occurrenceDays: 2,
        exists: false,
        adopted: false,
        lint: { ok: true, issues: [] },
      },
    ];
    (report as { skills: unknown[] }).skills = [
      {
        name: "progress-review",
        description: "当用户要求汇总进展时使用。",
        action: "create",
        evidence: [{ day: "2026-11-24" }],
        confidence: 0.8,
        occurrenceDays: 2,
        content: "---\nname: progress-review\ndescription: x\n---\n\n## 步骤\n1. 做\n",
        exists: false,
        adopted: false,
        lint: { ok: true, issues: [] },
      },
    ];
    (report as { counts: { rules: number; skills: number } }).counts.rules = 1;
    (report as { counts: { rules: number; skills: number } }).counts.skills = 1;
    renderPanel(api);
    await screen.findByRole("button", { name: "查看草稿" });
    await userEvent.click(screen.getByRole("button", { name: "查看草稿" }));
    await screen.findByRole("button", { name: "采纳全部安全项" });
    await userEvent.click(screen.getByRole("button", { name: "采纳全部安全项" }));
    await confirmDialog();
    await waitFor(() => {
      expect(api.adoptMemoryDreamRule).toHaveBeenCalledWith(
        "run-1",
        "report-timing",
      );
      expect(api.adoptMemoryDreamSkill).toHaveBeenCalledWith(
        "run-1",
        "progress-review",
      );
    });
  });

  it("ignores a skill draft and records the rejection", async () => {
    const api = mockApi(state());
    const report = await (api.getMemoryDreamReport as ReturnType<typeof vi.fn>)();
    (report as { skills: unknown[] }).skills = [
      {
        name: "progress-review",
        description: "当用户要求汇总进展时使用。",
        action: "create",
        evidence: [{ day: "2026-11-24" }],
        confidence: 0.8,
        content: "---\nname: progress-review\ndescription: x\n---\n\n## 步骤\n1. 做\n",
        exists: false,
        adopted: false,
        lint: { ok: true, issues: [] },
      },
    ];
    (report as { counts: { skills: number } }).counts.skills = 1;
    renderPanel(api);
    await screen.findByRole("button", { name: "查看草稿" });
    await userEvent.click(screen.getByRole("button", { name: "查看草稿" }));
    await screen.findByText("progress-review");
    await userEvent.click(screen.getByRole("button", { name: "忽略" }));
    await confirmDialog();
    await waitFor(() =>
      expect(api.rejectMemoryDreamDraft).toHaveBeenCalledWith(
        "run-1",
        "skill",
        "progress-review",
      ),
    );
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
    await confirmDialog();
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
