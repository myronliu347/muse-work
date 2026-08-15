/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import StatusDialog from "../../src/components/dialogs/StatusDialog";

describe("StatusDialog tokens", () => {
  it("shows latestTotalTokens from statusResponse", async () => {
    const vscode = { postMessage: () => {} };
    render(<StatusDialog onClose={() => {}} vscode={vscode} />);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "statusResponse",
            version: "1.0.0",
            sessionId: "sess-1",
            workdir: "/tmp",
            latestTotalTokens: 12345,
          },
        }),
      );
    });

    expect(screen.getByText("12345")).toBeInTheDocument();
    expect(screen.getByText(/上下文用量/)).toBeInTheDocument();
  });
});
