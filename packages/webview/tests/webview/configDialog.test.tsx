import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfigDialog from "../../src/components/ConfigDialog";
import type { ConfigurationData, VsCodeApi } from "../../src/types";

vi.mock("../../src/styles/ConfigurationDialog.css", () => ({}));
vi.mock("../../src/components/MuseProviderSettings", () => {
  const React = require("react") as typeof import("react");
  return {
    MuseProviderSettings: React.forwardRef(
      (
        props: { onSavingChange?: (saving: boolean) => void },
        ref: React.ForwardedRef<{ save: () => Promise<boolean> }>,
      ) => {
        React.useImperativeHandle(ref, () => ({
          save: async () => true,
        }));
        return (
          <div data-testid="muse-provider-settings">provider settings</div>
        );
      },
    ),
  };
});

const mockVscode = {
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
} as unknown as VsCodeApi;

function renderDialog(overrides?: {
  configurationData?: ConfigurationData;
  isLoading?: boolean;
  error?: string;
  onSave?: (config: ConfigurationData) => void;
  onCancel?: () => void;
}) {
  const onSave = overrides?.onSave ?? vi.fn();
  const onCancel = overrides?.onCancel ?? vi.fn();
  const result = render(
    <ConfigDialog
      configurationData={
        overrides?.configurationData ?? { language: "Chinese" }
      }
      isLoading={overrides?.isLoading ?? false}
      error={overrides?.error}
      onSave={onSave}
      onCancel={onCancel}
      vscode={mockVscode}
    />,
  );
  return { ...result, onSave, onCancel };
}

describe("ConfigDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders provider settings only (no legacy tabs)", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: "供应商设置" })).toBeTruthy();
    expect(screen.getByTestId("muse-provider-settings")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "全局设置" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "直连设置" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "项目设置" })).toBeNull();
  });

  it("calls onCancel when the close button is clicked", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the header close icon is clicked", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    // header close + footer share aria/name; click first close via aria on header
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onCancel when Escape is pressed", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders a save button and closes after successful save", async () => {
    const { onCancel } = renderDialog();
    expect(screen.getByTestId("config-dialog-save")).toBeTruthy();
    fireEvent.click(screen.getByTestId("config-dialog-save"));
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it("does not close on the same-tick mousedown that opened it, but closes on a later outside mousedown", () => {
    vi.useFakeTimers();
    try {
      const { onCancel } = renderDialog();

      const outside = document.createElement("div");
      document.body.appendChild(outside);
      fireEvent.mouseDown(outside);
      expect(onCancel).not.toHaveBeenCalled();

      vi.advanceTimersByTime(0);
      fireEvent.mouseDown(outside);
      expect(onCancel).toHaveBeenCalledTimes(1);

      document.body.removeChild(outside);
    } finally {
      vi.useRealTimers();
    }
  });
});
