/** @vitest-environment jsdom */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ConfigDialog from "../../src/components/dialogs/ConfigDialog";
import { MuseTheme } from "../../src/ui/theme";
import type { VsCodeApi } from "../../src/types";

let dirty = false;

vi.mock("../../src/styles/ConfigurationDialog.css", () => ({}));
vi.mock("../../src/components/settings/MuseProviderSettings", () => {
  const React = require("react") as typeof import("react");
  return {
    MuseProviderSettings: React.forwardRef(
      (
        _props: { onSavingChange?: (saving: boolean) => void },
        ref: React.ForwardedRef<{
          save: () => Promise<boolean>;
          isDirty: () => boolean;
        }>,
      ) => {
        React.useImperativeHandle(ref, () => ({
          save: async () => true,
          isDirty: () => dirty,
        }));
        return <div data-testid="muse-provider-settings">provider settings</div>;
      },
    ),
  };
});

vi.mock("../../src/components/settings/PluginSettings", () => ({
  PluginSettings: () => <div data-testid="plugin-settings">plugin settings</div>,
}));

const vscode = {
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
} as unknown as VsCodeApi;

function renderDialog(onCancel = vi.fn()) {
  return {
    onCancel,
    ...render(
      <MuseTheme>
        <ConfigDialog
          configurationData={{ language: "Chinese" }}
          isLoading={false}
          onSave={vi.fn()}
          onCancel={onCancel}
          vscode={vscode}
        />
      </MuseTheme>,
    ),
  };
}

describe("ConfigDialog appearance tab", () => {
  beforeEach(() => {
    cleanup();
    dirty = false;
    vi.clearAllMocks();
  });

  it("shows appearance first and provider after selecting its tab", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "插件" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "插件" }));
    expect(screen.getByTestId("plugin-settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "供应商" }));

    expect(screen.getByTestId("muse-provider-settings")).toBeTruthy();
  });

  it("renders tab underlines when prefers-reduced-motion is enabled", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    renderDialog();

    const appearanceTab = screen.getByRole("tab", { name: "外观" });
    const providerTab = screen.getByRole("tab", { name: "供应商" });
    expect(appearanceTab.querySelector(".settings-tab-underline")).toBeTruthy();

    fireEvent.click(providerTab);

    expect(providerTab.querySelector(".settings-tab-underline")).toBeTruthy();
  });

  it("moves the active-tab underline to the selected tab", () => {
    renderDialog();

    const appearanceTab = screen.getByRole("tab", { name: "外观" });
    const providerTab = screen.getByRole("tab", { name: "供应商" });
    expect(appearanceTab.querySelector(".settings-tab-underline")).toBeTruthy();
    expect(providerTab.querySelector(".settings-tab-underline")).toBeNull();

    fireEvent.click(providerTab);

    expect(appearanceTab.querySelector(".settings-tab-underline")).toBeNull();
    expect(providerTab.querySelector(".settings-tab-underline")).toBeTruthy();
  });

  it("uses the accent token for the active-tab underline", () => {
    renderDialog();

    const underline = screen
      .getByRole("tab", { name: "外观" })
      .querySelector(".settings-tab-underline");
    expect(underline).toHaveStyle({ backgroundColor: "var(--accent-9)" });
  });

  it("does not treat a theme change as provider settings dirtiness", () => {
    const { onCancel } = renderDialog();

    fireEvent.click(screen.getByRole("radio", { name: /深色/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[1]);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("prompts before closing when provider settings are dirty", () => {
    dirty = true;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onCancel } = renderDialog();

    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[1]);

    expect(confirm).toHaveBeenCalledWith("有未保存的修改，确定关闭？");
    expect(onCancel).not.toHaveBeenCalled();
  });
});
