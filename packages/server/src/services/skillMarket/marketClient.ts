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
  return { name, description, body, installs };
}

export async function fetchMarketSkillDetail(
  input: { source: string; skillId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MarketSkillDetail> {
  const source = isGitHubSource(input.source);
  if (!source || !isSafeSkillId(input.skillId)) {
    throw new SkillMarketError("技能来源不正确", 400);
  }
  const url = `https://www.skills.sh/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${encodeURIComponent(input.skillId)}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) {
      throw new SkillMarketError("技能市场上没有这个技能", 404);
    }
    if (!res.ok) throw new Error("upstream");
    return parseMarketSkillPage((await res.text()).slice(0, 500_000));
  } catch (error) {
    if (error instanceof SkillMarketError) throw error;
    throw new SkillMarketError("暂时读不到这个技能", 502);
  }
}
