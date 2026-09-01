import type { EffectiveTheme } from "../../types";
import darkLanterns from "../../assets/welcome-wallpapers/dark-lanterns.webp";
import darkRain from "../../assets/welcome-wallpapers/dark-rain.webp";
import darkMoon from "../../assets/welcome-wallpapers/dark-moon.webp";
import lightMorning from "../../assets/welcome-wallpapers/light-morning.webp";
import lightPaper from "../../assets/welcome-wallpapers/light-paper.webp";
import lightGarden from "../../assets/welcome-wallpapers/light-garden.webp";

export const WELCOME_WALLPAPERS: Record<EffectiveTheme, readonly string[]> = {
  dark: [darkLanterns, darkRain, darkMoon],
  light: [lightMorning, lightPaper, lightGarden],
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
