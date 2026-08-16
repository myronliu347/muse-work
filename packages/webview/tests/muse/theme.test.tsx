/** @vitest-environment jsdom */

import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuseTheme, useMuseTheme } from "../../src/ui/theme";
import { setThemePreference } from "../../src/ui/themePreference";

function ThemeProbe() {
  const { effective } = useMuseTheme();
  return <output data-testid="effective">{effective}</output>;
}

describe("MuseTheme desktop theme changes", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    document.body.className = "";
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies desktopThemeChange while preference is system", async () => {
    setThemePreference("system");
    render(
      <MuseTheme>
        <div />
      </MuseTheme>,
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "desktopThemeChange", effective: "light" },
        }),
      );
    });

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
    });
  });

  it("does not override a fixed dark preference on desktopThemeChange", async () => {
    setThemePreference("dark");
    render(
      <MuseTheme>
        <div />
      </MuseTheme>,
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "desktopThemeChange", effective: "light" },
        }),
      );
    });

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });
  });

  it("updates useMuseTheme effective when the desktop host theme changes", async () => {
    setThemePreference("system");
    const screen = render(
      <MuseTheme>
        <ThemeProbe />
      </MuseTheme>,
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "desktopThemeChange", effective: "dark" },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("effective")).toHaveTextContent("dark");
    });
  });
});
