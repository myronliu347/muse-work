/** @vitest-environment jsdom */
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppearanceSettings } from "../../src/components/AppearanceSettings";
import { MuseTheme } from "../../src/ui/theme";
import { setThemePreference } from "../../src/ui/themePreference";

describe("AppearanceSettings", () => {
  beforeEach(() => {
    cleanup();
    const memory = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => void memory.set(key, value),
      },
    });
    setThemePreference("system");
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies dark immediately without a save button", () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );

    fireEvent.click(screen.getByRole("button", { name: /深色/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: /跟随系统/ }));
    expect(
      screen.getByRole("button", { name: /跟随系统/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("visibly accents the selected appearance card", () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );

    const selected = screen.getByRole("button", { name: /跟随系统/ });
    expect(selected.getAttribute("style")).toContain(
      "border-color: var(--accent-9)",
    );
    expect(selected.getAttribute("style")).toContain(
      "background-color: var(--accent-3)",
    );
  });
});
