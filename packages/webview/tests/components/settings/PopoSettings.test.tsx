import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PopoSettings } from "../../../src/components/settings/PopoSettings";
import type { MuseApiClient } from "../../../src/muse/apiClient";

function stubApi(ready: boolean) {
  return {
    getPopoConfig: vi.fn().mockResolvedValue({
      url: "http://10.0.0.1:3100/popo/callback",
      token: "tk",
      aesKey: "ak",
      masterUid: "me@corp.netease.com",
      port: 3100,
      ready,
      configured: true,
      error: ready ? null : "listen EADDRINUSE: 3100",
    }),
  } as unknown as MuseApiClient;
}

describe("PopoSettings", () => {
  it("renders callback config rows", async () => {
    render(<PopoSettings api={stubApi(true)} />);
    expect(await screen.findByText("http://10.0.0.1:3100/popo/callback")).toBeInTheDocument();
    expect(screen.getByText("tk")).toBeInTheDocument();
    expect(screen.getByText("ak")).toBeInTheDocument();
    expect(screen.getByText("me@corp.netease.com")).toBeInTheDocument();
    expect(screen.getByText("回调就绪")).toBeInTheDocument();
  });

  it("shows the degraded notice when callback is not ready", async () => {
    render(<PopoSettings api={stubApi(false)} />);
    expect(await screen.findByText("回调未就绪")).toBeInTheDocument();
    expect(screen.getByText(/EADDRINUSE/)).toBeInTheDocument();
  });
});
