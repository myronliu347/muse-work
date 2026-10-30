import { describe, expect, it } from "vitest";
import { errorReplacer, serializeError } from "../../src/utils/errorUtils.js";

describe("serializeError", () => {
  it("keeps a non-enumerable cause that JSON.stringify would drop", () => {
    const cause = new Error("certificate has expired");
    Object.defineProperty(cause, "code", {
      value: "CERT_HAS_EXPIRED",
      enumerable: false,
    });
    const error = new TypeError("fetch failed");
    Object.defineProperty(error, "cause", { value: cause, enumerable: false });

    const serialized = serializeError(error);
    expect(JSON.parse(JSON.stringify({ error: serialized }))).toEqual({
      error: {
        name: "TypeError",
        message: "fetch failed",
        cause: {
          name: "Error",
          message: "certificate has expired",
          code: "CERT_HAS_EXPIRED",
        },
      },
    });
    expect(JSON.stringify(error)).toBe("{}");
  });

  it("summarizes a thrown non-Error", () => {
    expect(serializeError("nope")).toEqual({
      name: "NonError",
      message: "nope",
    });
  });

  it("renders nested errors through the replacer", () => {
    const error = new Error("boom");
    expect(JSON.parse(JSON.stringify({ error }, errorReplacer))).toEqual({
      error: { name: "Error", message: "boom" },
    });
  });
});
