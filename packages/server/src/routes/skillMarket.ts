import type { Context } from "hono";
import { Hono } from "hono";
import os from "node:os";
import { cloneGitHubRepo } from "../services/skillMarket/cloneRepo.js";
import { SkillMarketError } from "../services/skillMarket/errors.js";
import { installMarketSkill } from "../services/skillMarket/installSkill.js";
import {
  listInstalledSkills,
  readInstalledSkillDetail,
  uninstallInstalledSkill,
} from "../services/skillMarket/installedSkills.js";
import {
  fetchMarketSkillDetail,
  fetchMarketSkillSummaries,
  fetchSkillMarket,
} from "../services/skillMarket/marketClient.js";

type Deps = {
  fetchImpl?: typeof fetch;
  clone?: (repoUrl: string, dest: string) => Promise<void>;
  home?: () => string;
  onInstalled?: () => Promise<void>;
};

function fail(c: Context, error: unknown) {
  if (error instanceof SkillMarketError) {
    return c.json({ error: error.message }, error.status);
  }
  return c.json({ error: "仓库克隆失败" }, 502);
}

export function createSkillMarketRoutes(deps: Deps = {}) {
  const home = deps.home ?? (() => process.env.MUSE_HOME ?? os.homedir());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const clone = deps.clone ?? cloneGitHubRepo;
  const onInstalled = deps.onInstalled ?? (async () => {});
  const app = new Hono();

  app.get("/skills/installed", async (c) => {
    return c.json({ skills: await listInstalledSkills(home()) });
  });

  app.get("/skills/installed/detail", async (c) => {
    try {
      return c.json(
        await readInstalledSkillDetail(home(), c.req.query("path") ?? ""),
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  app.delete("/skills/installed", async (c) => {
    const body = await c.req.json().catch(() => ({} as { path?: string }));
    try {
      await uninstallInstalledSkill(home(), String(body.path ?? ""));
      await onInstalled();
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  app.get("/skill-market", async (c) => {
    const q = c.req.query("q");
    const page = Number(c.req.query("page") ?? "0");
    try {
      return c.json(
        await fetchSkillMarket(
          q === undefined ? { page: Number.isFinite(page) ? page : 0 } : { q },
          fetchImpl,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/skill-market/summaries", async (c) => {
    const body = await c.req.json().catch(() => ({} as { skills?: unknown }));
    const skills = Array.isArray(body.skills) ? body.skills : [];
    try {
      return c.json({
        summaries: await fetchMarketSkillSummaries(skills, fetchImpl),
      });
    } catch (error) {
      return fail(c, error);
    }
  });

  app.get("/skill-market/detail", async (c) => {
    try {
      return c.json(
        await fetchMarketSkillDetail(
          {
            source: c.req.query("source") ?? "",
            skillId: c.req.query("skillId") ?? "",
          },
          fetchImpl,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/skill-market/install", async (c) => {
    const body = await c.req
      .json()
      .catch(() => ({} as { source?: string; skillId?: string }));
    try {
      const installed = await installMarketSkill({
        source: String(body.source ?? ""),
        skillId: String(body.skillId ?? ""),
        home: home(),
        clone,
      });
      await onInstalled();
      return c.json(installed);
    } catch (error) {
      return fail(c, error);
    }
  });

  return app;
}
