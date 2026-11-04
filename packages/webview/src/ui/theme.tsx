import React, { useEffect, useSyncExternalStore } from "react";
import { Theme } from "@radix-ui/themes";
import type {
  EffectiveTheme,
  ThemeAccentColor,
  ThemeGrayColor,
  ThemePreference,
  ThemeRadius,
  ThemeScaling,
} from "../types";
import { installScrollingScrollbars } from "./scrollingScrollbar";
import { resolveEffectiveTheme } from "./themeStorage";
import {
  getSystemDark,
  getThemeAccentColor,
  getThemeGrayColor,
  getThemePreference,
  getThemeRadius,
  getThemeScaling,
  setThemeAccentColor,
  setThemeGrayColor,
  setThemePreference,
  setThemeRadius,
  setThemeScaling,
  subscribeSystemDark,
  subscribeThemeAccentColor,
  subscribeThemeGrayColor,
  subscribeThemePreference,
  subscribeThemeRadius,
  subscribeThemeScaling,
} from "./themePreference";

function applyDataTheme(effective: EffectiveTheme): void {
  document.documentElement.setAttribute("data-theme", effective);
}

export function MuseTheme({ children }: { children: React.ReactNode }) {
  const { effective, scaling, accentColor, radius, grayColor } = useMuseTheme();

  useEffect(() => {
    applyDataTheme(effective);
  }, [effective]);

  useEffect(() => installScrollingScrollbars(), []);

  return (
    <Theme
      accentColor={accentColor}
      grayColor={grayColor}
      panelBackground="solid"
      radius={radius}
      scaling={scaling}
      appearance={effective}
    >
      {children}
      <div id="muse-overlay-root" className="muse-overlay-root" />
    </Theme>
  );
}

export function useMuseTheme(): {
  preference: ThemePreference;
  effective: EffectiveTheme;
  setPreference: (p: ThemePreference) => void;
  scaling: ThemeScaling;
  setScaling: (s: ThemeScaling) => void;
  accentColor: ThemeAccentColor;
  setAccentColor: (c: ThemeAccentColor) => void;
  radius: ThemeRadius;
  setRadius: (r: ThemeRadius) => void;
  grayColor: ThemeGrayColor;
  setGrayColor: (g: ThemeGrayColor) => void;
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
  const scaling = useSyncExternalStore(
    subscribeThemeScaling,
    getThemeScaling,
    getThemeScaling,
  );
  const accentColor = useSyncExternalStore(
    subscribeThemeAccentColor,
    getThemeAccentColor,
    getThemeAccentColor,
  );
  const radius = useSyncExternalStore(
    subscribeThemeRadius,
    getThemeRadius,
    getThemeRadius,
  );
  const grayColor = useSyncExternalStore(
    subscribeThemeGrayColor,
    getThemeGrayColor,
    getThemeGrayColor,
  );
  const effective = resolveEffectiveTheme(preference, systemDark);
  return {
    preference,
    effective,
    setPreference: setThemePreference,
    scaling,
    setScaling: setThemeScaling,
    accentColor,
    setAccentColor: setThemeAccentColor,
    radius,
    setRadius: setThemeRadius,
    grayColor,
    setGrayColor: setThemeGrayColor,
  };
}
