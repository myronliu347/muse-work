import { resolveTavilyApiKey } from "../tavilyConfig.js";

const TAVILY_ORIGIN = "https://api.tavily.com";
const SNIPPET_MAX = 1200;

export type TavilyOptions = {
  /** 显式传入时覆盖文件和环境变量。空字符串视为未配置。 */
  apiKey?: string;
  /** 未传 apiKey 时，从这里读已保存的密钥，再回落到环境变量。 */
  home?: string;
  fetch?: typeof fetch;
};

type TavilyResult = { ok: true; value: unknown } | { ok: false; error: string };

function clip(input: string, max: number): string {
  const chars = [...input];
  if (chars.length <= max) return input;
  return `${chars.slice(0, max).join("")}…`;
}

function apiKey(options: TavilyOptions): string {
  if (options.apiKey !== undefined) return options.apiKey.trim();
  if (options.home) return resolveTavilyApiKey(options.home).key;
  return (process.env.TAVILY_API_KEY ?? "").trim();
}

async function post(
  body: Record<string, unknown>,
  options: TavilyOptions,
): Promise<TavilyResult> {
  const key = apiKey(options);
  if (!key) return { ok: false, error: "未配置 TAVILY_API_KEY" };
  const fetchImpl = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${TAVILY_ORIGIN}/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: `Tavily search ${response.status}: ${clip(raw, 300)}`,
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, error: "Tavily search 返回的不是 JSON" };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export async function tavilySearch(
  body: Record<string, unknown>,
  options: TavilyOptions = {},
): Promise<TavilyResult> {
  const result = await post(body, options);
  if (!result.ok) return result;
  const payload = asRecord(result.value);
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const answer = typeof payload?.answer === "string" ? payload.answer : undefined;
  return {
    ok: true,
    value: {
      ...(answer ? { answer } : {}),
      results: rows.flatMap((row) => {
        const item = asRecord(row);
        if (!item || typeof item.url !== "string") return [];
        const content = typeof item.content === "string" ? clip(item.content, SNIPPET_MAX) : "";
        return [
          {
            title: typeof item.title === "string" ? item.title : "",
            url: item.url,
            content,
            ...(typeof item.published_date === "string"
              ? { publishedDate: item.published_date }
              : {}),
          },
        ];
      }),
    },
  };
}
