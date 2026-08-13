/** @vitest-environment jsdom */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PluginSettings } from "../../src/components/PluginSettings";
import { MuseTheme } from "../../src/ui/theme";
import type { MuseApiClient } from "../../src/muse/apiClient";

function mockClient(opts: {
  get?: { version: 1; plugins: { superpowers: boolean } };
  updateError?: string;
}): MuseApiClient {
  return {
    getSettings: vi.fn(async () => {
      return opts.get ?? { version: 1, plugins: { superpowers: true } };
    }),
    updateSettings: vi.fn(async (patch: { plugins: { superpowers: boolean } }) => {
      if (opts.updateError) throw new Error(opts.updateError);
      return { version: 1 as const, plugins: patch.plugins };
    }),
  } as unknown as MuseApiClient;
}

describe("PluginSettings", () => {
  beforeEach(() => {
    cleanup();
  });

  it("checks the Superpowers toggle by default", async () => {
    render(
      <MuseTheme>
        <PluginSettings api={mockClient({})} />
      </MuseTheme>,
    );
    const toggle = await screen.findByTestId("superpowers-toggle");
    expect(toggle).toBeChecked();
  });

  it("PATCHes superpowers false when clicked", async () => {
    const api = mockClient({});
    render(
      <MuseTheme>
        <PluginSettings api={api} />
      </MuseTheme>,
    );
    const toggle = await screen.findByTestId("superpowers-toggle");
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(api.updateSettings).toHaveBeenCalledWith({
        plugins: { superpowers: false },
      });
    });
  });

  it("rolls back and shows an error when PATCH fails", async () => {
    const api = mockClient({ updateError: "network down" });
    render(
      <MuseTheme>
        <PluginSettings api={api} />
      </MuseTheme>,
    );
    const toggle = await screen.findByTestId("superpowers-toggle");
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeTruthy();
    });
    expect(toggle).toBeChecked();
  });
});
