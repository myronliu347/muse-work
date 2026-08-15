import React from "react";
import { useMuseTheme } from "../../ui/theme";
import { Field } from "../../ui/Field";
import { Tooltip } from "../shared/Tooltip";
import type { ThemePreference, ThemeScaling } from "../../types";
import {
  THEME_ACCENT_COLORS,
  THEME_GRAY_COLORS,
  THEME_GRAY_COLOR_LABELS,
  THEME_RADII,
  THEME_RADIUS_LABELS,
} from "../../ui/themeOptions";
import "../../styles/AppearanceSettings.css";

const preferences: Array<{
  value: ThemePreference;
  label: string;
  hint: string;
}> = [
  { value: "system", label: "跟随系统", hint: "默认" },
  { value: "light", label: "浅色", hint: "固定 Light" },
  { value: "dark", label: "深色", hint: "固定 Dark" },
];

const scalings: Array<{
  value: ThemeScaling;
  label: string;
}> = [
  { value: "90%", label: "紧凑" },
  { value: "95%", label: "偏紧" },
  { value: "100%", label: "默认" },
  { value: "105%", label: "偏松" },
  { value: "110%", label: "宽松" },
];

function graySwatchStyle(color: (typeof THEME_GRAY_COLORS)[number]) {
  if (color === "auto") return undefined;
  return { backgroundColor: `var(--${color}-9)` };
}

function ThemePreview({ value }: { value: ThemePreference }) {
  return (
    <span className="appearance-card-preview" data-preview={value} aria-hidden>
      {value === "system" ? (
        <>
          <span className="appearance-card-preview-half is-light">
            <span className="appearance-card-preview-sidebar" />
            <span className="appearance-card-preview-main">
              <span className="appearance-card-preview-line" />
              <span className="appearance-card-preview-line" />
            </span>
          </span>
          <span className="appearance-card-preview-half is-dark">
            <span className="appearance-card-preview-sidebar" />
            <span className="appearance-card-preview-main">
              <span className="appearance-card-preview-line" />
              <span className="appearance-card-preview-line" />
            </span>
          </span>
        </>
      ) : (
        <>
          <span className="appearance-card-preview-sidebar" />
          <span className="appearance-card-preview-main">
            <span className="appearance-card-preview-line" />
            <span className="appearance-card-preview-line" />
            <span className="appearance-card-preview-line is-short" />
          </span>
        </>
      )}
    </span>
  );
}

export function AppearanceSettings() {
  const {
    preference,
    setPreference,
    scaling,
    setScaling,
    accentColor,
    setAccentColor,
    radius,
    setRadius,
    grayColor,
    setGrayColor,
  } = useMuseTheme();

  return (
    <div className="muse-settings-stack" data-testid="appearance-settings">
      <Field
        label="外观"
        hint="未设置时跟随操作系统。切换立即生效，无需点保存。"
      >
        <div className="appearance-cards" role="radiogroup" aria-label="外观">
          {preferences.map(({ value, label, hint }) => (
            <button
              key={value}
              type="button"
              role="radio"
              className="appearance-card"
              aria-checked={preference === value}
              aria-pressed={preference === value}
              onClick={() => setPreference(value)}
            >
              <ThemePreview value={value} />
              <span className="appearance-card-copy">
                <span className="appearance-card-label">{label}</span>
                <small className="appearance-card-hint">{hint}</small>
              </span>
            </button>
          ))}
        </div>
      </Field>
      <Field
        label="强调色"
        hint="影响发送按钮、焦点边框、选中态等。切换立即生效，无需点保存。"
      >
        <div
          className="appearance-accent-grid"
          role="radiogroup"
          aria-label="强调色"
        >
          {THEME_ACCENT_COLORS.map((color) => (
            <Tooltip key={color} text={color} position="top">
              <button
                type="button"
                role="radio"
                className="appearance-accent-swatch"
                aria-checked={accentColor === color}
                aria-pressed={accentColor === color}
                aria-label={color}
                style={{ backgroundColor: `var(--${color}-9)` }}
                onClick={() => setAccentColor(color)}
              />
            </Tooltip>
          ))}
        </div>
      </Field>
      <Field
        label="灰阶"
        hint="影响背景、边框与次要文字的整体色调。切换立即生效，无需点保存。"
      >
        <div
          className="appearance-accent-grid appearance-gray-grid"
          role="radiogroup"
          aria-label="灰阶"
        >
          {THEME_GRAY_COLORS.map((color) => (
            <Tooltip
              key={color}
              text={THEME_GRAY_COLOR_LABELS[color]}
              position="top"
            >
              <button
                type="button"
                role="radio"
                className={`appearance-accent-swatch appearance-gray-swatch${color === "auto" ? " is-auto" : ""}`}
                aria-checked={grayColor === color}
                aria-pressed={grayColor === color}
                aria-label={THEME_GRAY_COLOR_LABELS[color]}
                style={graySwatchStyle(color)}
                onClick={() => setGrayColor(color)}
              />
            </Tooltip>
          ))}
        </div>
      </Field>
      <Field
        label="圆角"
        hint="影响按钮、输入框、气泡等圆角大小。切换立即生效，无需点保存。"
      >
        <div className="appearance-radius" role="radiogroup" aria-label="圆角">
          {THEME_RADII.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              className="appearance-radius-btn"
              aria-checked={radius === value}
              aria-pressed={radius === value}
              aria-label={THEME_RADIUS_LABELS[value]}
              onClick={() => setRadius(value)}
            >
              <span
                className="appearance-radius-preview"
                data-radius={value}
                aria-hidden
              />
              <span className="appearance-radius-label">
                {THEME_RADIUS_LABELS[value]}
              </span>
            </button>
          ))}
        </div>
      </Field>
      <Field
        label="排版密度"
        hint="同时缩放字号和间距。切换立即生效，无需点保存。"
      >
        <div
          className="appearance-scale"
          role="radiogroup"
          aria-label="排版密度"
        >
          {scalings.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              className="appearance-scale-btn"
              aria-checked={scaling === value}
              aria-pressed={scaling === value}
              aria-label={`${label} ${value}`}
              onClick={() => setScaling(value)}
            >
              <span className="appearance-scale-label">{label}</span>
              <small className="appearance-scale-hint">{value}</small>
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}
