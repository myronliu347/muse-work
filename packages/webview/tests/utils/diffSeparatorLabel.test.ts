/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  localizeDiffHost,
  localizeUnmodifiedLineLabel,
} from "../../src/utils/diffSeparatorLabel";

describe("diff separator labels", () => {
  it("translates Pierre's collapsed-context copy", () => {
    expect(localizeUnmodifiedLineLabel("45 unmodified lines")).toBe("45 行未修改");
    expect(localizeUnmodifiedLineLabel("1 unmodified line")).toBe("1 行未修改");
    expect(localizeUnmodifiedLineLabel("Expand all")).toBe("全部展开");
    expect(localizeUnmodifiedLineLabel("More unchanged context may be available")).toBe(
      "可能还有未改动的内容",
    );
  });

  it("rewrites labels inside an open shadow root", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<span data-unmodified-lines>504 unmodified lines</span>`;
    localizeDiffHost(host);
    expect(shadow.querySelector("[data-unmodified-lines]")?.textContent).toBe(
      "504 行未修改",
    );
  });
});
