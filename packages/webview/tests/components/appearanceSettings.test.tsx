/** @vitest-environment jsdom */
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppearanceSettings } from "../../src/components/AppearanceSettings";
import { MuseTheme } from "../../src/ui/theme";
import { setThemePreference, setThemeScaling, setThemeAccentColor, setThemeRadius, setThemeGrayColor } from "../../src/ui/themePreference";

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
    setThemeScaling("100%");
    setThemeAccentColor("red");
    setThemeRadius("large");
    setThemeGrayColor("gray");
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies dark immediately without a save button", () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );

    fireEvent.click(screen.getByRole("radio", { name: /深色/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(screen.getByRole("radio", { name: /跟随系统/ }));
    expect(
      screen.getByRole("radio", { name: /跟随系统/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("renders three preview cards with labels and hints", () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );

    expect(screen.getByRole("radiogroup", { name: "外观" })).toBeTruthy();
    expect(document.querySelectorAll(".appearance-card")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /跟随系统/ })).toHaveTextContent(
      "默认",
    );
    expect(screen.getByRole("radio", { name: /浅色/ })).toHaveTextContent(
      "固定 Light",
    );
    expect(screen.getByRole("radio", { name: /深色/ })).toHaveTextContent(
      "固定 Dark",
    );
  });

  it("visibly accents the selected appearance card", () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );

    const selected = screen.getByRole("radio", { name: /跟随系统/ });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected.className).toContain("appearance-card");
    expect(selected.getAttribute("style")).toBeNull();
  });

  it("applies scaling immediately without a save button", () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );

    expect(screen.getByRole("radiogroup", { name: "排版密度" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /宽松 110%/ }));
    expect(
      screen.getByRole("radio", { name: /宽松 110%/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      document.querySelector(".radix-themes")?.getAttribute("data-scaling"),
    ).toBe("110%");
  });

  it("applies accent color and radius immediately", () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "blue" }));
    fireEvent.click(screen.getByRole("radio", { name: "小" }));

    const themeRoot = document.querySelector(".radix-themes");
    expect(themeRoot?.getAttribute("data-accent-color")).toBe("blue");
    expect(themeRoot?.getAttribute("data-radius")).toBe("small");
  });

  it("applies gray color immediately", () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Slate" }));
    expect(document.querySelector(".radix-themes")?.getAttribute("data-gray-color")).toBe(
      "slate",
    );
  });

  it("shows tooltip text on accent color hover", async () => {
    render(
      <MuseTheme>
        <AppearanceSettings />
      </MuseTheme>,
    );

    fireEvent.mouseEnter(screen.getByRole("radio", { name: "blue" }));
    const tooltips = await screen.findAllByRole("tooltip");
    expect(
      tooltips.find((node) => node.classList.contains("visible")),
    ).toHaveTextContent("blue");
  });
});
