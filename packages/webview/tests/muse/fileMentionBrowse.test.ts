import { describe, expect, it } from "vitest";
import {
  breadcrumbCrumbs,
  dirFromRelativePath,
  fileSuggestionsRequestPayload,
  parentBrowsePath,
  resolveFileMentionKey,
} from "../../src/utils/fileMentionBrowse";

describe("parentBrowsePath / dirFromRelativePath", () => {
  it("strips trailing slash and walks up", () => {
    expect(dirFromRelativePath("src/components/")).toBe("src/components");
    expect(parentBrowsePath("src/components")).toBe("src");
    expect(parentBrowsePath("src")).toBe("");
    expect(parentBrowsePath("")).toBe("");
  });
});

describe("breadcrumbCrumbs", () => {
  it("starts at 工作区 and accumulates paths", () => {
    expect(breadcrumbCrumbs("")).toEqual([{ label: "工作区", path: "" }]);
    expect(breadcrumbCrumbs("src/components")).toEqual([
      { label: "工作区", path: "" },
      { label: "src", path: "src" },
      { label: "components", path: "src/components" },
    ]);
  });
});

describe("fileSuggestionsRequestPayload", () => {
  it("sends dir only when filter is empty", () => {
    expect(fileSuggestionsRequestPayload("", "src", "1")).toEqual({
      command: "requestFileSuggestions",
      filterText: "",
      requestId: "1",
      dir: "src",
    });
    expect(fileSuggestionsRequestPayload("hello", "src", "2")).toEqual({
      command: "requestFileSuggestions",
      filterText: "hello",
      requestId: "2",
    });
  });
});

describe("resolveFileMentionKey", () => {
  const dir = { isDirectory: true };
  const file = { isDirectory: false };

  it("Enter selects, ArrowRight enters a directory, ArrowLeft/Backspace go up", () => {
    expect(
      resolveFileMentionKey({
        key: "Enter",
        filterText: "",
        browsePath: "",
        suggestions: [dir],
        selectedIndex: 0,
      }),
    ).toEqual({ type: "select", index: 0 });

    expect(
      resolveFileMentionKey({
        key: "ArrowRight",
        filterText: "",
        browsePath: "",
        suggestions: [dir],
        selectedIndex: 0,
      }),
    ).toEqual({ type: "enterDir", index: 0 });

    expect(
      resolveFileMentionKey({
        key: "ArrowRight",
        filterText: "",
        browsePath: "",
        suggestions: [file],
        selectedIndex: 0,
      }),
    ).toBeNull();

    expect(
      resolveFileMentionKey({
        key: "ArrowLeft",
        filterText: "",
        browsePath: "src",
        suggestions: [dir],
        selectedIndex: 0,
      }),
    ).toEqual({ type: "goUp" });

    expect(
      resolveFileMentionKey({
        key: "Backspace",
        filterText: "",
        browsePath: "src",
        suggestions: [],
        selectedIndex: 0,
      }),
    ).toEqual({ type: "goUp" });

    expect(
      resolveFileMentionKey({
        key: "Backspace",
        filterText: "",
        browsePath: "",
        suggestions: [],
        selectedIndex: 0,
      }),
    ).toBeNull();

    expect(
      resolveFileMentionKey({
        key: "Backspace",
        filterText: "s",
        browsePath: "",
        suggestions: [file],
        selectedIndex: 0,
      }),
    ).toBeNull();
  });
});
