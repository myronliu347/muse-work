/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import { AssistantHandoffSettings } from "../../src/components/settings/AssistantHandoffSettings";
import type {
  AssistantHandoffState,
  MuseApiClient,
} from "../../src/muse/apiClient";

function state(overrides: Partial<AssistantHandoffState> = {}): AssistantHandoffState {
  return {
    version: 1,
    enabled: true,
    hour: 4,
    nextRunAt: Date.now() + 60_000,
    working: false,
    handoffPath: "/Users/me/assistant-chat/HANDOFF.md",
    handoff: "# 交接\n\n- 修复登录 500",
    archiveRoot: "/Users/me/.muse-work/db/assistant-messages-archive",
    ...overrides,
  };
}

function mockApi(next: AssistantHandoffState) {
  return {
    getAssistantHandoff: vi.fn().mockResolvedValue(next),
    setAssistantHandoff: vi.fn().mockImplementation(async (patch) => ({
      ...next,
      ...patch,
    })),
    runAssistantHandoff: vi.fn().mockResolvedValue({
      ok: true,
      handoff: next.handoff,
      handoffPath: next.handoffPath,
    }),
  };
}

function renderPanel(api: ReturnType<typeof mockApi>) {
  return render(
    <Theme>
      <AssistantHandoffSettings api={api as unknown as MuseApiClient} />
    </Theme>,
  );
}

describe("AssistantHandoffSettings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the switch on by default and turns it off", async () => {
    const api = mockApi(state());
    renderPanel(api);
    await screen.findByText("每天自动收工");
    const toggle = screen.getByRole("switch", { name: "每天自动收工" });
    expect(toggle).toHaveAttribute("data-state", "checked");
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(api.setAssistantHandoff).toHaveBeenCalledWith({ enabled: false }),
    );
  });

  it("runs a manual handoff after confirmation", async () => {
    const api = mockApi(state());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel(api);
    await screen.findByRole("button", { name: "立即收工" });
    await userEvent.click(screen.getByRole("button", { name: "立即收工" }));
    await waitFor(() => expect(api.runAssistantHandoff).toHaveBeenCalled());
    expect(await screen.findByText(/已收工/)).toBeTruthy();
  });
});
