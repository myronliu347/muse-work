import { useEffect, useRef, useState } from "react";
import { useMuseTheme } from "../../ui/theme";
import {
  pickWelcomeWallpaper,
  readLastWelcomeWallpaper,
  rememberWelcomeWallpaper,
} from "./welcomeWallpapers";

function pickAndRemember(theme: "light" | "dark", exclude?: string): string {
  const next = pickWelcomeWallpaper(theme, { exclude });
  rememberWelcomeWallpaper(next);
  return next;
}

/** Pick a theme-pool wallpaper on mount; reshuffle only when light/dark flips. */
export function useWelcomeWallpaper(): string {
  const { effective } = useMuseTheme();
  const [src, setSrc] = useState(() =>
    pickAndRemember(effective, readLastWelcomeWallpaper()),
  );
  const themeRef = useRef(effective);

  useEffect(() => {
    if (themeRef.current === effective) return;
    themeRef.current = effective;
    setSrc((prev) => pickAndRemember(effective, prev));
  }, [effective]);

  return src;
}
