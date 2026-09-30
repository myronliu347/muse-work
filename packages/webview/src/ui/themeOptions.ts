import type {
  ThemeAccentColor,
  ThemeGrayColor,
  ThemeRadius,
  ThemeScaling,
} from "../types";

export const DEFAULT_THEME_SCALING: ThemeScaling = "100%";
export const DEFAULT_THEME_ACCENT_COLOR: ThemeAccentColor = "indigo";
export const DEFAULT_THEME_RADIUS: ThemeRadius = "large";
export const DEFAULT_THEME_GRAY_COLOR: ThemeGrayColor = "gray";

export const THEME_SCALINGS: readonly ThemeScaling[] = [
  "90%",
  "95%",
  "100%",
  "105%",
  "110%",
];

export const THEME_ACCENT_COLORS: readonly ThemeAccentColor[] = [
  "gray",
  "gold",
  "bronze",
  "brown",
  "yellow",
  "amber",
  "orange",
  "tomato",
  "red",
  "ruby",
  "crimson",
  "pink",
  "plum",
  "purple",
  "violet",
  "iris",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "jade",
  "green",
  "grass",
  "lime",
  "mint",
  "sky",
];

export const THEME_RADII: readonly ThemeRadius[] = [
  "none",
  "small",
  "medium",
  "large",
  "full",
];

export const THEME_GRAY_COLORS: readonly ThemeGrayColor[] = [
  "auto",
  "gray",
  "mauve",
  "slate",
  "sage",
  "olive",
  "sand",
];

export const THEME_RADIUS_LABELS: Record<ThemeRadius, string> = {
  none: "直角",
  small: "小",
  medium: "中",
  large: "大",
  full: "全圆",
};

export const THEME_GRAY_COLOR_LABELS: Record<ThemeGrayColor, string> = {
  auto: "跟随强调色",
  gray: "Gray",
  mauve: "Mauve",
  slate: "Slate",
  sage: "Sage",
  olive: "Olive",
  sand: "Sand",
};

export function isThemeAccentColor(value: unknown): value is ThemeAccentColor {
  return (
    typeof value === "string" &&
    (THEME_ACCENT_COLORS as readonly string[]).includes(value)
  );
}

export function isThemeRadius(value: unknown): value is ThemeRadius {
  return (
    typeof value === "string" &&
    (THEME_RADII as readonly string[]).includes(value)
  );
}

export function isThemeGrayColor(value: unknown): value is ThemeGrayColor {
  return (
    typeof value === "string" &&
    (THEME_GRAY_COLORS as readonly string[]).includes(value)
  );
}
