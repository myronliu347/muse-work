import { SkillMarketError } from "./errors.js";
import { isGitHubSource, isSafeSkillId } from "./locateSkill.js";

export type MarketSkill = {
  source: string;
  skillId: string;
  name: string;
  installs: number;
  isOfficial?: boolean;
};

function normalize(value: unknown): MarketSkill | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.source !== "string" ||
    typeof row.skillId !== "string" ||
    typeof row.name !== "string" ||
    typeof row.installs !== "number"
  ) {
    return null;
  }
  return {
    source: row.source,
    skillId: row.skillId,
    name: row.name,
    installs: row.installs,
    ...(row.isOfficial === true ? { isOfficial: true } : {}),
  };
}

export async function fetchSkillMarket(
  input: { q?: string; page?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ skills: MarketSkill[]; hasMore: boolean }> {
  const q = input.q?.trim() ?? "";
  if (input.q !== undefined && q.length < 2) {
    throw new SkillMarketError("搜索至少两个字", 400);
  }
  const url = q
    ? `https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=50`
    : `https://www.skills.sh/api/skills/all-time/${input.page ?? 0}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error("upstream");
    const body = (await res.json()) as { skills?: unknown; hasMore?: unknown };
    const skills = Array.isArray(body.skills)
      ? body.skills
          .map(normalize)
          .filter((skill): skill is MarketSkill => skill !== null)
      : [];
    return { skills, hasMore: q ? false : body.hasMore === true };
  } catch (error) {
    if (error instanceof SkillMarketError) throw error;
    throw new SkillMarketError("技能市场暂时打不开", 502);
  }
}

export type MarketSkillDetail = {
  name: string;
  description: string;
  body: string;
  installs: number;
  command: string;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function htmlToText(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h1|h2|h3|h4|ul|ol|pre|blockquote)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12_000);
}

function proseAfterSkillFile(html: string): string {
  const marker = html.indexOf(">SKILL.md<");
  if (marker < 0) return "";
  const prose = html.indexOf('class="prose', marker);
  if (prose < 0) return "";
  const open = html.lastIndexOf("<div", prose);
  if (open < 0) return "";
  let cursor = html.indexOf(">", open);
  if (cursor < 0) return "";
  const start = cursor + 1;
  let depth = 1;
  cursor += 1;
  while (cursor < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", cursor);
    const nextClose = html.indexOf("</div>", cursor);
    if (nextClose < 0) return "";
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + 4;
      continue;
    }
    depth -= 1;
    if (depth === 0) return htmlToText(html.slice(start, nextClose));
    cursor = nextClose + 6;
  }
  return "";
}

export function parseMarketSkillPage(html: string): MarketSkillDetail {
  let name = "";
  let description = "";
  let installs = 0;
  for (const match of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )) {
    try {
      const data = JSON.parse(match[1]) as {
        "@type"?: string;
        name?: unknown;
        description?: unknown;
        interactionStatistic?: { userInteractionCount?: unknown };
      };
      if (data["@type"] !== "SoftwareApplication") continue;
      if (typeof data.name === "string") name = data.name;
      if (typeof data.description === "string") description = data.description;
      const count = data.interactionStatistic?.userInteractionCount;
      if (typeof count === "number") installs = count;
    } catch {
      continue;
    }
  }
  const body = proseAfterSkillFile(html);
  if (!name && !description && !body) {
    throw new SkillMarketError("暂时读不到这个技能", 502);
  }
  return { name, description, body, installs, command: "" };
}

export function installCommandFromPage(html: string, skillId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(skillId)) return "";
  const url = /npx skills add (https:\/\/[A-Za-z0-9._/-]+)/.exec(html)?.[1];
  if (!url) return "";
  return `npx skills add ${url} --skill ${skillId}`;
}

export function skillPageUrl(source: string, skillId: string): string {
  if (!isSafeSkillId(skillId)) {
    throw new SkillMarketError("技能来源不正确", 400);
  }
  const github = isGitHubSource(source);
  if (github) {
    return `https://www.skills.sh/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/${encodeURIComponent(skillId)}`;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(source) || source === "." || source === "..") {
    throw new SkillMarketError("技能来源不正确", 400);
  }
  return `https://www.skills.sh/site/${encodeURIComponent(source)}/${encodeURIComponent(skillId)}`;
}

export function skillBrief(detail: MarketSkillDetail, skillName = ""): string {
  const description = detail.description.trim();
  if (description && !description.startsWith("Install the ")) return description;
  const line = detail.body
    .split("\n")
    .map((part) => part.replace(/^•\s*/, "").trim())
    .find((part) => part.length > 12 && part.toLowerCase() !== skillName.toLowerCase());
  return (line ?? description).slice(0, 220);
}

const summaryCache = new Map<string, { description: string; command: string }>();

async function mapLimit<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await run(current);
    }
  });
  await Promise.all(workers);
}

export async function fetchMarketSkillSummaries(
  skills: Array<{ source?: unknown; skillId?: unknown }>,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ source: string; skillId: string; description: string; command: string }>> {
  const unique: Array<{ source: string; skillId: string }> = [];
  const seen = new Set<string>();
  for (const skill of skills.slice(0, 24)) {
    if (typeof skill.source !== "string" || typeof skill.skillId !== "string") continue;
    const key = `${skill.source}/${skill.skillId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ source: skill.source, skillId: skill.skillId });
  }
  await mapLimit(unique, 6, async (skill) => {
    const key = `${skill.source}/${skill.skillId}`;
    if (summaryCache.has(key)) return;
    try {
      const detail = await fetchMarketSkillDetail(skill, fetchImpl);
      summaryCache.set(key, {
        description: skillBrief(detail, skill.skillId),
        command: detail.command,
      });
    } catch {
      summaryCache.set(key, { description: "", command: "" });
    }
  });
  return unique.map((skill) => {
    const cached = summaryCache.get(`${skill.source}/${skill.skillId}`);
    return {
      ...skill,
      description: cached?.description ?? "",
      command: cached?.command ?? "",
    };
  });
}

export async function fetchMarketSkillDetail(
  input: { source: string; skillId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MarketSkillDetail> {
  const url = skillPageUrl(input.source, input.skillId);
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) {
      throw new SkillMarketError("技能市场上没有这个技能", 404);
    }
    if (!res.ok) throw new Error("upstream");
    const html = (await res.text()).slice(0, 500_000);
    const detail = parseMarketSkillPage(html);
    return { ...detail, command: installCommandFromPage(html, input.skillId) };
  } catch (error) {
    if (error instanceof SkillMarketError) throw error;
    throw new SkillMarketError("暂时读不到这个技能", 502);
  }
}
