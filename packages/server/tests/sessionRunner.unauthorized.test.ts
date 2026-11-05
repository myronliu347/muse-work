import { describe, expect, it } from "vitest";
import { isUnauthorized } from "../src/services/sessionRunner/serialization.js";

const EXPIRED_TOKEN_403 =
  'HTTP 403 Forbidden: {"msg":"auth failed","extra":{"code":30002,"msg":"request access token is invalid: token error: Token is expired"}}';

describe("isUnauthorized", () => {
  it("matches expired-token 403 strings from SDK error blocks", () => {
    expect(isUnauthorized(EXPIRED_TOKEN_403)).toBe(true);
    expect(isUnauthorized(new Error(EXPIRED_TOKEN_403))).toBe(true);
  });

  it("matches 401 thrown errors", () => {
    const err = new Error("Unauthorized") as Error & { status: number };
    err.status = 401;
    expect(isUnauthorized(err)).toBe(true);
  });

  it("does not match compact / generic failures", () => {
    expect(
      isUnauthorized(
        "Failed to compact conversation history: Compaction failed: the model produced no summary output.",
      ),
    ).toBe(false);
    expect(isUnauthorized(new Error("network error"))).toBe(false);
    const forbidden = new Error("disabled") as Error & { status: number };
    forbidden.status = 403;
    expect(isUnauthorized(forbidden)).toBe(false);
  });
});
