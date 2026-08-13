import React, { useEffect, useSyncExternalStore } from "react";
import { Theme } from "@radix-ui/themes";
import type { EffectiveTheme, ThemePreference } from "../types";
import { resolveEffectiveTheme } from "./themeStorage";
import {
  getSystemDark,
  getThemePreference,
  setThemePreference,
  subscribeSystemDark,
  subscribeThemePreference,
} from "./themePreference";

function applyDataTheme(effective: EffectiveTheme): void {
  document.documentElement.setAttribute("data-theme", effective);
}

export function MuseTheme({ children }: { children: React.ReactNode }) {
  const { effective } = useMuseTheme();

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
  const preference = useSyncExternalStore(
    subscribeThemePreference,
    getThemePreference,
    getThemePreference,
  );
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    getSystemDark,
    getSystemDark,
  );
  const effective = resolveEffectiveTheme(preference, systemDark);
  return {
    preference,
    effective,
    setPreference: setThemePreference,
  };
}
