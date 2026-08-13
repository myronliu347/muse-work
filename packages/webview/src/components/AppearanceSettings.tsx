import React from "react";
import { useMuseTheme } from "../ui/theme";
import { Field } from "../ui/Field";
import type { ThemePreference } from "../types";
import "../styles/AppearanceSettings.css";

const preferences: Array<{
  value: ThemePreference;
  label: string;
  hint: string;
}> = [
  { value: "system", label: "跟随系统", hint: "默认" },
  { value: "light", label: "浅色", hint: "固定 Light" },
  { value: "dark", label: "深色", hint: "固定 Dark" },
];

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
  const { preference, setPreference } = useMuseTheme();

  return (
    <div data-testid="appearance-settings">
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
    </div>
  );
}
