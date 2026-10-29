import { describe, expect, it } from "vitest";
import {
  isCloseFocusedInput,
  tabStepDirection,
  type TabStepInput,
} from "../src/main/tabStepShortcut.js";

function input(partial: Partial<TabStepInput>): TabStepInput {
  return {
    type: "keyDown",
    key: "[",
    code: "BracketLeft",
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...partial,
  };
}

describe("tabStepDirection", () => {
  it("uses Command on macOS and Control elsewhere", () => {
    expect(tabStepDirection(input({ meta: true, key: "[", code: "BracketLeft" }), "darwin")).toBe(-1);
    expect(tabStepDirection(input({ meta: true, key: "]", code: "BracketRight" }), "darwin")).toBe(1);
    expect(tabStepDirection(input({ control: true, key: "]" }), "darwin")).toBeNull();
    expect(tabStepDirection(input({ control: true, key: "[", code: "BracketLeft" }), "win32")).toBe(-1);
    expect(tabStepDirection(input({ meta: true, key: "]" }), "win32")).toBeNull();
  });

  it("ignores keyup, shift, and alt", () => {
    expect(tabStepDirection(input({ type: "keyUp", meta: true }), "darwin")).toBeNull();
    expect(tabStepDirection(input({ meta: true, shift: true }), "darwin")).toBeNull();
    expect(tabStepDirection(input({ meta: true, alt: true }), "darwin")).toBeNull();
  });
});

describe("isCloseFocusedInput", () => {
  it("uses Command+W on macOS and Control+W elsewhere", () => {
    expect(isCloseFocusedInput(input({ meta: true, key: "w", code: "KeyW" }), "darwin")).toBe(true);
    expect(isCloseFocusedInput(input({ meta: true, key: "W", code: "KeyW" }), "darwin")).toBe(true);
    expect(isCloseFocusedInput(input({ control: true, key: "w" }), "darwin")).toBe(false);
    expect(isCloseFocusedInput(input({ meta: true, shift: true, key: "w" }), "darwin")).toBe(false);
    expect(isCloseFocusedInput(input({ control: true, key: "w" }), "win32")).toBe(true);
    expect(isCloseFocusedInput(input({ meta: true, key: "w" }), "win32")).toBe(false);
  });
});
