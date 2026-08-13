import { describe, expect, it } from "vitest";
import { normalizeQuotaUsage } from "../src/codemaker/quota.js";

describe("normalizeQuotaUsage", () => {
  it("reads current_month usage_cost / remaining / percentage", () => {
    const usage = normalizeQuotaUsage({
      code: 0,
      data: {
        access_user: "alice",
        current_month: {
          usage_cost: 3.73,
          remaining: 4996.29,
          percentage: 0.07,
        },
      },
    });
    expect(usage.user).toBe("alice");
    expect(usage.used).toBe(3.73);
    expect(usage.remaining).toBe(4996.29);
    expect(usage.total).toBeCloseTo(5000.02, 2);
    expect(usage.percentage).toBe(0.07);
  });

  it("reads nested data fields and derives remaining", () => {
    const usage = normalizeQuotaUsage({
      code: 0,
      data: {
        user: "alice",
        total: 1000,
        used: 250,
      },
    });
    expect(usage.user).toBe("alice");
    expect(usage.total).toBe(1000);
    expect(usage.used).toBe(250);
    expect(usage.remaining).toBe(750);
    expect(usage.percentage).toBe(25);
  });

  it("accepts alternate field names", () => {
    const usage = normalizeQuotaUsage({
      quota: "500",
      usage: "100",
      remain: "400",
      access_user: "bob",
    });
    expect(usage.user).toBe("bob");
    expect(usage.total).toBe(500);
    expect(usage.used).toBe(100);
    expect(usage.remaining).toBe(400);
  });
});
