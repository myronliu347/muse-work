/** @vitest-environment jsdom */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PluginSettings } from "../../src/components/settings/PluginSettings";
import { MuseTheme } from "../../src/ui/theme";
import type { MuseApiClient } from "../../src/muse/apiClient";

function mockClient(opts: {
  get?: { version: 1; plugins: { superpowers: boolean; mattpocock: boolean } };
  updateError?: string;
}): MuseApiClient {
  return {
    getSettings: vi.fn(async () => {
      return (
        opts.get ?? {
          version: 1,
          plugins: { superpowers: false, mattpocock: true },
        }
      );
    }),
    updateSettings: vi.fn(
      async (patch: {
        plugins: { superpowers?: boolean; mattpocock?: boolean };
      }) => {
        if (opts.updateError) throw new Error(opts.updateError);
        return {
          version: 1 as const,
          plugins: {
            superpowers: patch.plugins.superpowers ?? false,
            mattpocock: patch.plugins.mattpocock ?? true,
          },
        };
      },
    ),
  } as unknown as MuseApiClient;
}

describe("PluginSettings", () => {
  beforeEach(() => {
    cleanup();
  });

  it("checks MattPocock and unchecks Superpowers by default", async () => {
    render(
      <MuseTheme>
        <PluginSettings api={mockClient({})} />
      </MuseTheme>,
    );
    const mattpocock = await screen.findByTestId("mattpocock-toggle");
    expect(mattpocock).toBeChecked();
    const superpowers = screen.getByTestId("superpowers-toggle");
    expect(superpowers).not.toBeChecked();
  });

  it("PATCHes mattpocock false when clicked", async () => {
    const api = mockClient({});
    render(
      <MuseTheme>
        <PluginSettings api={api} />
      </MuseTheme>,
    );
    const toggle = await screen.findByTestId("mattpocock-toggle");
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(api.updateSettings).toHaveBeenCalledWith({
        plugins: { mattpocock: false },
      });
    });
  });

  it("PATCHes superpowers true when clicked", async () => {
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
        plugins: { superpowers: true },
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
    const toggle = await screen.findByTestId("mattpocock-toggle");
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(screen.getAllByText(/network down/i).length).toBeGreaterThan(0);
    });
    expect(toggle).toBeChecked();
  });
});
