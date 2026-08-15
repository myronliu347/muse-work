/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { AgentSettings } from "../../src/components/settings/AgentSettings";
import type { MuseApiClient } from "../../src/muse/apiClient";

function renderAgent(api: MuseApiClient) {
  return render(
    <Theme>
      <AgentSettings api={api} />
    </Theme>,
  );
}

describe("AgentSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads ~/.wave settings text and blocks save on invalid JSON", async () => {
    const api = {
      getSettingsRaw: vi.fn().mockResolvedValue({
        path: "/tmp/.wave/settings.json",
        content: '{\n  "env": {}\n}\n',
      }),
      putSettingsRaw: vi.fn(),
    } as unknown as MuseApiClient;

    renderAgent(api);
    await waitFor(() => {
      expect(screen.getByTestId("agent-settings-editor")).toHaveValue(
        '{\n  "env": {}\n}\n',
      );
    });
    expect(screen.getByText(/\/tmp\/\.wave\/settings\.json/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("agent-settings-editor"), {
      target: { value: "{" },
    });
    expect(screen.getByText("JSON 格式无效")).toBeInTheDocument();
    expect(api.putSettingsRaw).not.toHaveBeenCalled();
  });

  it("saves valid JSON via putSettingsRaw", async () => {
    const api = {
      getSettingsRaw: vi.fn().mockResolvedValue({
        path: "/tmp/.wave/settings.json",
        content: "{}\n",
      }),
      putSettingsRaw: vi.fn().mockResolvedValue({
        path: "/tmp/.wave/settings.json",
        content: '{\n  "env": {\n    "A": "1"\n  }\n}\n',
      }),
    } as unknown as MuseApiClient;

    const ref = React.createRef<{
      save: () => Promise<boolean>;
      isDirty: () => boolean;
    }>();
    render(
      <Theme>
        <AgentSettings api={api} ref={ref} />
      </Theme>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("agent-settings-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("agent-settings-editor"), {
      target: { value: '{"env":{"A":"1"}}' },
    });
    const ok = await ref.current!.save();
    expect(ok).toBe(true);
    expect(api.putSettingsRaw).toHaveBeenCalledWith('{"env":{"A":"1"}}');
  });
});
