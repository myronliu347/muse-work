import React from "react";
import { Card, Flex } from "@radix-ui/themes";
import { useMuseTheme } from "../ui/theme";
import { Field } from "../ui/Field";
import type { ThemePreference } from "../types";

const preferences: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export function AppearanceSettings() {
  const { preference, setPreference } = useMuseTheme();

  return (
    <Card data-testid="appearance-settings">
      <Field
        label="外观"
        hint="未设置时跟随操作系统。切换立即生效，无需点保存。"
      >
        <Flex gap="2" wrap="wrap">
          {preferences.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={preference === value}
              onClick={() => setPreference(value)}
            >
              {label}
            </button>
          ))}
        </Flex>
      </Field>
    </Card>
  );
}
