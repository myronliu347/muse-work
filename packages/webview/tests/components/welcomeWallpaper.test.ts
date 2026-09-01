import { describe, expect, it } from "vitest";
import {
  pickWelcomeWallpaper,
  WELCOME_WALLPAPERS,
} from "../../src/components/chat/welcomeWallpapers";

describe("pickWelcomeWallpaper", () => {
  it("picks only from the dark pool", () => {
    const url = pickWelcomeWallpaper("dark", { random: () => 0 });
    expect(WELCOME_WALLPAPERS.dark).toContain(url);
  });

  it("picks only from the light pool", () => {
    const url = pickWelcomeWallpaper("light", { random: () => 0.99 });
    expect(WELCOME_WALLPAPERS.light).toContain(url);
  });

  it("skips the excluded wallpaper when others remain", () => {
    const exclude = WELCOME_WALLPAPERS.dark[0];
    const url = pickWelcomeWallpaper("dark", {
      exclude,
      random: () => 0,
    });
    expect(url).not.toBe(exclude);
    expect(WELCOME_WALLPAPERS.dark).toContain(url);
  });
});
