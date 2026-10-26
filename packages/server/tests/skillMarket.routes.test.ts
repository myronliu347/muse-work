import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSkillMarketRoutes } from "../src/routes/skillMarket.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("skill market routes", () => {
  it("serves the catalog, installs one skill, and rejects a bad uninstall path", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "muse-route-"));
    homes.push(home);
    const onInstalled = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          skills: [
            {
              source: "acme/skills",
              skillId: "find-skills",
              name: "find-skills",
              installs: 4,
            },
          ],
          hasMore: false,
        }),
        { status: 200 },
      ),
    );
    const app = new Hono();
    app.route(
      "/",
      createSkillMarketRoutes({
        home: () => home,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onInstalled,
        clone: async (_url, dest) => {
          const dir = path.join(dest, "skills", "find-skills");
          await mkdir(dir, { recursive: true });
          await writeFile(
            path.join(dir, "SKILL.md"),
            "---\nname: find-skills\ndescription: find\n---\n\n说明正文\n",
          );
        },
      }),
    );

    const short = await app.request("/skill-market?q=a");
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "搜索至少两个字" });

    const market = await app.request("/skill-market?page=0");
    expect(await market.json()).toEqual({
      skills: [
        {
          source: "acme/skills",
          skillId: "find-skills",
          name: "find-skills",
          installs: 4,
        },
      ],
      hasMore: false,
    });

    const installedRes = await app.request("/skill-market/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "acme/skills", skillId: "find-skills" }),
    });
    expect(installedRes.status).toBe(200);
    expect(await installedRes.json()).toEqual({
      name: "find-skills",
      path: path.join(home, ".agents", "skills", "find-skills"),
    });
    expect(onInstalled).toHaveBeenCalledOnce();

    const listed = await app.request("/skills/installed");
    expect(await listed.json()).toEqual({
      skills: [
        {
          name: "find-skills",
          description: "find",
          path: path.join(home, ".agents", "skills", "find-skills"),
        },
      ],
    });

    const detail = await app.request(
      `/skills/installed/detail?path=${encodeURIComponent(path.join(home, ".agents", "skills", "find-skills"))}`,
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      name: "find-skills",
      description: "find",
      body: "说明正文",
    });

    const deniedDetail = await app.request(
      "/skills/installed/detail?path=%2Fetc",
    );
    expect(deniedDetail.status).toBe(400);

    const denied = await app.request("/skills/installed", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/etc" }),
    });
    expect(denied.status).toBe(400);
  });

  it("returns 502 when the catalog is down", async () => {
    const app = new Hono();
    app.route(
      "/",
      createSkillMarketRoutes({
        fetchImpl: (async () =>
          new Response("no", { status: 500 })) as unknown as typeof fetch,
      }),
    );
    const res = await app.request("/skill-market?page=0");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "技能市场暂时打不开" });
  });
});
