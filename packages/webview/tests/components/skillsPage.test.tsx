import { render, screen, waitFor } from "@testing-library/react";
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
      getMarketSkillSummaries: vi.fn(async () => ({
        summaries: [
          {
            source: "acme/skills",
            skillId: "find-skills",
            description: "帮你发现技能",
          },
        ],
      })),
      uninstallInstalledSkill: vi.fn(async () => ({ ok: true as const })),
    };
    render(<SkillsPage api={api as unknown as MuseApiClient} />);
    expect(await screen.findByRole("tab", { name: "已安装" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("tab", { name: "技能市场" }));
    expect(screen.getByRole("tab", { name: "技能市场" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "已安装" })).toBeDisabled();
    expect(screen.getByText("官方")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "在终端安装" })).toBeDisabled();
    expect(await screen.findByText("帮你发现技能")).toBeInTheDocument();
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
      getMarketSkillSummaries: vi.fn(async () => ({ summaries: [] })),
      uninstallInstalledSkill: vi.fn(),
    };
    render(<SkillsPage api={api as unknown as MuseApiClient} />);
    await user.click(await screen.findByRole("tab", { name: "技能市场" }));
    await user.click(screen.getByRole("button", { name: "find-skills" }));
    expect(await screen.findByText("发现技能")).toBeInTheDocument();
    expect(screen.getByText("先看排行榜")).toBeInTheDocument();
    expect(api.getMarketSkillDetail).toHaveBeenCalledWith({
      source: "acme/skills",
      skillId: "find-skills",
    });
  });

  it("opens the terminal with the install command", async () => {
    const user = userEvent.setup();
    const onRunInTerminal = vi.fn();
    const command =
      "npx skills add https://open.feishu.cn/lark-cli/skills/regular --skill lark-attendance";
    const api = {
      listInstalledSkills: vi.fn(async () => ({ skills: [] })),
      getSkillMarket: vi.fn(async () => ({
        skills: [
          {
            source: "open.feishu.cn",
            skillId: "lark-attendance",
            name: "lark-attendance",
            installs: 3,
          },
        ],
        hasMore: false,
      })),
      getMarketSkillSummaries: vi.fn(async () => ({
        summaries: [
          {
            source: "open.feishu.cn",
            skillId: "lark-attendance",
            description: "考勤",
            command,
          },
        ],
      })),
      getMarketSkillDetail: vi.fn(),
      installMarketSkill: vi.fn(),
      uninstallInstalledSkill: vi.fn(),
    };
    render(
      <SkillsPage
        api={api as unknown as MuseApiClient}
        onRunInTerminal={onRunInTerminal}
      />,
    );
    await user.click(await screen.findByRole("tab", { name: "技能市场" }));
    expect(await screen.findByText(command)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "在终端安装" }));
    expect(onRunInTerminal).toHaveBeenCalledWith(command);
    expect(api.installMarketSkill).not.toHaveBeenCalled();
  });

  it("shows a loading state and then an empty state", async () => {
    const user = userEvent.setup();
    let resolveInstalled: (value: { skills: [] }) => void = () => {};
    let resolveMarket: (value: { skills: []; hasMore: false }) => void = () => {};
    const api = {
      listInstalledSkills: vi.fn(
        () => new Promise<{ skills: [] }>((resolve) => {
          resolveInstalled = resolve;
        }),
      ),
      getSkillMarket: vi.fn(
        () => new Promise<{ skills: []; hasMore: false }>((resolve) => {
          resolveMarket = resolve;
        }),
      ),
      getMarketSkillSummaries: vi.fn(async () => ({ summaries: [] })),
      getMarketSkillDetail: vi.fn(),
      installMarketSkill: vi.fn(),
      uninstallInstalledSkill: vi.fn(),
    };
    render(<SkillsPage api={api as unknown as MuseApiClient} />);
    expect(screen.getByText("正在加载已安装的技能")).toBeInTheDocument();
    resolveInstalled({ skills: [] });
    expect(await screen.findByText("还没有安装技能")).toBeInTheDocument();
    expect(screen.getByText("从技能市场安装之后，所有会话都能用。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "去技能市场" }));
    expect(screen.getByText("正在加载技能")).toBeInTheDocument();
    resolveMarket({ skills: [], hasMore: false });
    expect(await screen.findByText("市场上暂时没有技能")).toBeInTheDocument();
  });

  it("closes the drawer with escape and switches when another skill is clicked", async () => {
    const user = userEvent.setup();
    const detail = vi.fn(async (query: { skillId: string }) => ({
      name: query.skillId,
      description: `${query.skillId} 的说明`,
      body: `${query.skillId} 的正文`,
      installs: 1,
      command: "",
    }));
    const api = {
      listInstalledSkills: vi.fn(async () => ({ skills: [] })),
      getSkillMarket: vi.fn(async () => ({
        skills: [
          { source: "acme/skills", skillId: "find-skills", name: "find-skills", installs: 40 },
          { source: "acme/skills", skillId: "grill", name: "grill", installs: 12 },
        ],
        hasMore: false,
      })),
      getMarketSkillDetail: detail,
      getMarketSkillSummaries: vi.fn(async () => ({ summaries: [] })),
      installMarketSkill: vi.fn(),
      uninstallInstalledSkill: vi.fn(),
    };
    render(<SkillsPage api={api as unknown as MuseApiClient} />);
    await user.click(await screen.findByRole("tab", { name: "技能市场" }));
    await user.click(await screen.findByRole("button", { name: "find-skills" }));
    expect(await screen.findByRole("heading", { name: "find-skills" })).toBeInTheDocument();
    expect(await screen.findByText("find-skills 的正文")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "grill" }));
    expect(screen.getByRole("heading", { name: "grill" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "find-skills" })).not.toBeInTheDocument();
    expect(await screen.findByText("grill 的正文")).toBeInTheDocument();
    expect(screen.getByTestId("skill-detail")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("skill-detail")).toHaveClass("is-closing");
    await waitFor(() => {
      expect(screen.queryByTestId("skill-detail")).not.toBeInTheDocument();
    });
  });
});
