/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { AgentSelector } from "../../src/components/chat/AgentSelector";
import type { MuseApiClient } from "../../src/muse/apiClient";

function apiStub() {
  return {
    getAgents: vi.fn().mockResolvedValue({
      version: 1,
      agents: [
        {
          key: "default",
          name: "Muse",
          personality: "professional",
          personalityLabel: "专业严谨",
          systemPrompt: "",
          model: "deepseek-v4-flash",
          fastModel: "",
          tools: [],
          permission: [],
        },
        {
          key: "xiaomei",
          name: "小美",
          personality: "warm-patient",
          personalityLabel: "温和耐心",
          systemPrompt: "请用中文回复",
          model: "m2",
          fastModel: "",
          tools: [],
          permission: [],
        },
      ],
    }),
    getAgentScenarios: vi.fn().mockResolvedValue({
        scenarios: {
          session: "default",
          popo: "popo",
          "issue-plan": "plan",
          "issue-exec": "execute",
        },
    }),
  } as unknown as MuseApiClient;
}

describe("AgentSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows current agent name and lists all agents on open", async () => {
    render(
      <Theme>
        <AgentSelector api={apiStub()} agentName="xiaomei" onSelect={() => {}} />
      </Theme>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("agent-selector")).toBeInTheDocument();
    });
    // 当前 agent 显示小美（trigger 标签内；tooltip 卡片里也会出现，故按 trigger 内断言）
    expect(
      screen.getByTestId("agent-selector").querySelector(".agent-selector-label")
        ?.textContent,
    ).toBe("小美");

    fireEvent.click(screen.getByTestId("agent-selector"));
    await waitFor(() => {
      expect(screen.getByTestId("agent-selector-menu")).toBeInTheDocument();
    });
    expect(screen.getByText("Muse")).toBeInTheDocument();
    // 性格显示名
    expect(screen.getByText("温和耐心")).toBeInTheDocument();
  });

  it("calls onSelect when picking an agent", async () => {
    const onSelect = vi.fn();
    render(
      <Theme>
        <AgentSelector api={apiStub()} agentName="default" onSelect={onSelect} />
      </Theme>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("agent-selector")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("agent-selector"));
    await waitFor(() => {
      expect(screen.getByTestId("agent-selector-menu")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("小美"));
    expect(onSelect).toHaveBeenCalledWith("xiaomei");
  });

  it("falls back to defaultAgentName when no agentName", async () => {
    render(
      <Theme>
        <AgentSelector
          api={apiStub()}
          defaultAgentName="default"
          onSelect={() => {}}
        />
      </Theme>,
    );
    await waitFor(() => {
      expect(
        screen
          .getByTestId("agent-selector")
          .querySelector(".agent-selector-label")?.textContent,
      ).toBe("Muse");
    });
  });
});
