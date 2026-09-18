import type { EffectiveTheme } from "../../types";
import darkMist from "../../assets/welcome-wallpapers/dark-mist.webp";
import darkSea from "../../assets/welcome-wallpapers/dark-sea.webp";
import darkMoon from "../../assets/welcome-wallpapers/dark-moon.webp";
import lightFog from "../../assets/welcome-wallpapers/light-fog.webp";
import lightSky from "../../assets/welcome-wallpapers/light-sky.webp";
import lightDune from "../../assets/welcome-wallpapers/light-dune.webp";

export const WELCOME_WALLPAPERS: Record<EffectiveTheme, readonly string[]> = {
  dark: [darkMist, darkSea, darkMoon],
  light: [lightFog, lightSky, lightDune],
};

const LAST_WALLPAPER_KEY = "muse-welcome-wallpaper";

export function pickWelcomeWallpaper(
  theme: EffectiveTheme,
  options?: { exclude?: string; random?: () => number },
): string {
  const pool = WELCOME_WALLPAPERS[theme];
  const exclude = options?.exclude;
  const random = options?.random ?? Math.random;
  const choices = exclude ? pool.filter((url) => url !== exclude) : pool;
  const list = choices.length > 0 ? choices : pool;
  return list[Math.floor(random() * list.length)]!;
}

export function readLastWelcomeWallpaper(): string | undefined {
  try {
    return sessionStorage.getItem(LAST_WALLPAPER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberWelcomeWallpaper(url: string): void {
  try {
    sessionStorage.setItem(LAST_WALLPAPER_KEY, url);
  } catch {
    /* private mode / blocked storage */
  }
}
