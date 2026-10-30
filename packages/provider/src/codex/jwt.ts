export interface ChatGptClaims {
  accountId?: string;
  email?: string;
  /** Unix seconds from the JWT `exp` claim. */
  exp?: number;
}

export function parseChatGptClaims(token: string): ChatGptClaims {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return {};
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as {
      email?: unknown;
      exp?: unknown;
      "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
    };
    const auth = payload["https://api.openai.com/auth"];
    const accountId = auth?.chatgpt_account_id;
    return {
      accountId: typeof accountId === "string" && accountId ? accountId : undefined,
      email: typeof payload.email === "string" && payload.email ? payload.email : undefined,
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
    };
  } catch {
    return {};
  }
}
