import React, { useEffect, useMemo, useState } from "react";
import { Theme } from "@radix-ui/themes";
import type { EffectiveTheme, ThemePreference } from "../types";
import { resolveEffectiveTheme } from "./themeStorage";
import {
  detectSystemDark,
  getThemePreference,
  setThemePreference,
  subscribeThemePreference,
} from "./themePreference";

function applyDataTheme(effective: EffectiveTheme): void {
  document.documentElement.setAttribute("data-theme", effective);
}

export function MuseTheme({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getThemePreference(),
  );
  const [systemDark, setSystemDark] = useState(() => detectSystemDark());

  useEffect(
    () =>
      subscribeThemePreference(() => {
        setPreferenceState(getThemePreference());
      }),
    [],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => setSystemDark(detectSystemDark());
    media.addEventListener("change", onMedia);
    const observer = new MutationObserver(onMedia);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const onHost = (event: MessageEvent) => {
      const data = event.data as { command?: string; effective?: string };
      if (data?.command !== "desktopThemeChange") return;
      if (getThemePreference() !== "system") return;
      if (data.effective === "light" || data.effective === "dark") {
        setSystemDark(data.effective === "dark");
      }
    };
    window.addEventListener("message", onHost);
    return () => {
      media.removeEventListener("change", onMedia);
      observer.disconnect();
      window.removeEventListener("message", onHost);
    };
  }, []);

  const effective = useMemo(
    () => resolveEffectiveTheme(preference, systemDark),
    [preference, systemDark],
  );

  useEffect(() => {
    applyDataTheme(effective);
  }, [effective]);

  return (
    <Theme
      accentColor="red"
      grayColor="gray"
      panelBackground="solid"
      radius="large"
      appearance={effective}
    >
      {children}
    </Theme>
  );
}

export function useMuseTheme(): {
  preference: ThemePreference;
  effective: EffectiveTheme;
  setPreference: (p: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getThemePreference(),
  );
  useEffect(
    () =>
      subscribeThemePreference(() => {
        setPreferenceState(getThemePreference());
      }),
    [],
  );
  const effective = resolveEffectiveTheme(preference, detectSystemDark());
  return {
    preference,
    effective,
    setPreference: setThemePreference,
  };
}
