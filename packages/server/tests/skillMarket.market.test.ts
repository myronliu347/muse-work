import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMarketSkill } from "../src/services/skillMarket/installSkill.js";
import { fetchSkillMarket, parseMarketSkillPage } from "../src/services/skillMarket/marketClient.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("skill market", () => {
  it("normalizes the leaderboard and ignores page when searching", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/api/search")) {
        return new Response(
          JSON.stringify({
            skills: [
              {
                source: "vercel-labs/skills",
                skillId: "find-skills",
                name: "find-skills",
                installs: 10,
                extra: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          skills: [
            {
              source: "mattpocock/skills",
              skillId: "grill-me",
              name: "grill-me",
              installs: 3,
              isOfficial: true,
            },
          ],
          hasMore: true,
        }),
        { status: 200 },
      );
    });
    const page = await fetchSkillMarket(
      { page: 0 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(page).toEqual({
      skills: [
        {
          source: "mattpocock/skills",
          skillId: "grill-me",
          name: "grill-me",
          installs: 3,
          isOfficial: true,
        },
      ],
      hasMore: true,
    });
    await fetchSkillMarket(
      { q: "  react ", page: 4 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(String(fetchImpl.mock.calls[1][0])).toContain("q=react");
    expect(String(fetchImpl.mock.calls[1][0])).not.toContain("page=");
  });

  it("turns an upstream failure into a 502", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(
      fetchSkillMarket({ page: 0 }, fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({
      status: 502,
      message: "技能市场暂时打不开",
    });
  });

  it("installs the matched directory under ~/.agents/skills and does not overwrite", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "muse-install-"));
    homes.push(home);
    const clone = vi.fn(async (_url: string, dest: string) => {
      const dir = path.join(dest, "skills", "find-skills");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "SKILL.md"),
        "---\nname: find-skills\ndescription: find\n---\n",
      );
      await writeFile(path.join(dir, "notes.txt"), "hi");
    });
    const installed = await installMarketSkill({
      source: "vercel-labs/skills",
      skillId: "find-skills",
      home,
      clone,
    });
    expect(installed.path).toBe(
      path.join(home, ".agents", "skills", "find-skills"),
    );
    await expect(
      installMarketSkill({
        source: "vercel-labs/skills",
        skillId: "find-skills",
        home,
        clone,
      }),
    ).rejects.toMatchObject({ message: "已经安装", status: 409 });
  });

  it("reads the public skill page description and body", () => {
    const detail = parseMarketSkillPage(`
      <script type="application/ld+json">{"@type":"SoftwareApplication","name":"find-skills","description":"发现技能","interactionStatistic":{"userInteractionCount":12000}}</script>
      <span>SKILL.md</span>
      <div class="prose"><p>帮你找技能</p><ul><li>先看排行榜</li></ul></div>
    `);
    expect(detail).toEqual({
      name: "find-skills",
      description: "发现技能",
      body: "帮你找技能\n• 先看排行榜",
      installs: 12000,
    });
  });
});
