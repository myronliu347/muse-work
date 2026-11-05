import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import ConfigDialog from "../../src/components/dialogs/ConfigDialog";
import type { ConfigurationData, VsCodeApi } from "../../src/types";

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
          isDirty: () => false,
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
    <Theme>
      <ConfigDialog
        configurationData={
          overrides?.configurationData ?? { language: "Chinese" }
        }
        isLoading={overrides?.isLoading ?? false}
        error={overrides?.error}
        onSave={onSave}
        onCancel={onCancel}
        vscode={mockVscode}
      />
    </Theme>,
  );
  return { ...result, onSave, onCancel };
}

describe("ConfigDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders provider settings only (no legacy tabs)", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    expect(screen.getByTestId("muse-provider-settings")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "全局设置" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "直连设置" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "项目设置" })).toBeNull();
  });

  it("calls onCancel when the close button is clicked", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the header close icon is clicked", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]!);
    // header close + footer share aria/name; click first close via aria on header
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onCancel when Escape is pressed", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows 已保存 on the settings page and keeps the page open", async () => {
    const onCancel = vi.fn();
    render(
      <Theme>
        <ConfigDialog
          layout="page"
          configurationData={{ language: "Chinese" }}
          isLoading={false}
          onSave={vi.fn()}
          onCancel={onCancel}
          vscode={mockVscode}
        />
      </Theme>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "供应商" }));
    fireEvent.click(screen.getByTestId("config-dialog-save"));
    expect(await screen.findByTestId("config-dialog-saved")).toHaveTextContent(
      "已保存",
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("hides save on appearance and closes after save on the provider tab", async () => {
    const { onCancel } = renderDialog();
    expect(screen.queryByTestId("config-dialog-save")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "供应商" }));
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

  it("does not close when mousedown lands on a Radix popup (Select dropdown portal to body)", () => {
    vi.useFakeTimers();
    try {
      const { onCancel } = renderDialog();
      vi.advanceTimersByTime(0);

      // 模拟 Radix Select 下拉 portal 到 body 的弹层（item-aligned 外层 plain div，
      // popper 变体是 data-radix-popper-content-wrapper；都内含 role="listbox"）。
      for (const popup of [
        { attrs: { "data-radix-popper-content-wrapper": "" }, role: "listbox" },
        { attrs: {}, role: "listbox" },
      ]) {
        const el = document.createElement("div");
        for (const [k, v] of Object.entries(popup.attrs)) el.setAttribute(k, v);
        if (popup.role) el.setAttribute("role", popup.role);
        const option = document.createElement("div");
        option.setAttribute("role", "option");
        el.appendChild(option);
        document.body.appendChild(el);

        fireEvent.mouseDown(option);
        expect(onCancel).not.toHaveBeenCalled();

        document.body.removeChild(el);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes when mousedown lands on the settings overlay outside the dialog (radix popup guard does not over-exempt)", () => {
    vi.useFakeTimers();
    try {
      const { onCancel } = renderDialog();
      vi.advanceTimersByTime(0);

      // 设置弹窗外、但不是任何 Radix 弹层的普通节点 → 应关闭
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      fireEvent.mouseDown(outside);
      expect(onCancel).toHaveBeenCalledTimes(1);
      document.body.removeChild(outside);
    } finally {
      vi.useRealTimers();
    }
  });
});
