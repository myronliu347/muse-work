import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillsPage } from "../../src/components/skills/SkillsPage";
import type { MuseApiClient } from "../../src/muse/apiClient";

describe("SkillsPage", () => {
  it("shows installed skills and installs a market row", async () => {
    const user = userEvent.setup();
    const api = {
      listInstalledSkills: vi.fn(async () => ({
        skills: [{ name: "grill", description: "问清楚", path: "/tmp/grill" }],
      })),
      getSkillMarket: vi.fn(async () => ({
        skills: [
          { source: "acme/skills", skillId: "grill", name: "grill", installs: 12 },
          {
            source: "acme/skills",
            skillId: "find-skills",
            name: "find-skills",
            installs: 40,
            isOfficial: true,
          },
          { source: "not a repo", skillId: "odd", name: "odd", installs: 1 },
        ],
        hasMore: false,
      })),
      installMarketSkill: vi.fn(async () => ({
        name: "find-skills",
        path: "/tmp/find-skills",
      })),
      uninstallInstalledSkill: vi.fn(async () => ({ ok: true as const })),
    };
    render(<SkillsPage api={api as unknown as MuseApiClient} />);
    expect(await screen.findByRole("heading", { name: "已安装" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "技能市场" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已安装" })).toBeDisabled();
    expect(screen.getByText("官方")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "需用 CLI 安装" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "安装" }));
    expect(api.installMarketSkill).toHaveBeenCalledWith({
      source: "acme/skills",
      skillId: "find-skills",
    });
  });

  it("opens the skill detail from a market card", async () => {
    const user = userEvent.setup();
    const api = {
      listInstalledSkills: vi.fn(async () => ({ skills: [] })),
      getSkillMarket: vi.fn(async () => ({
        skills: [
          {
            source: "acme/skills",
            skillId: "find-skills",
            name: "find-skills",
            installs: 40,
          },
        ],
        hasMore: false,
      })),
      getMarketSkillDetail: vi.fn(async () => ({
        name: "find-skills",
        description: "发现技能",
        body: "先看排行榜",
        installs: 40,
      })),
      getInstalledSkillDetail: vi.fn(),
      installMarketSkill: vi.fn(),
      uninstallInstalledSkill: vi.fn(),
    };
    render(<SkillsPage api={api as unknown as MuseApiClient} />);
    await user.click(await screen.findByRole("button", { name: "find-skills" }));
    expect(await screen.findByText("发现技能")).toBeInTheDocument();
    expect(screen.getByText("先看排行榜")).toBeInTheDocument();
    expect(api.getMarketSkillDetail).toHaveBeenCalledWith({
      source: "acme/skills",
      skillId: "find-skills",
    });
  });
});
