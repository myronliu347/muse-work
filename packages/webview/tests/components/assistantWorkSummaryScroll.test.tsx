/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AssistantWorkSummary } from "../../src/components/message/AssistantWorkSummary";
import { HoldTranscriptScrollProvider } from "../../src/components/chat/holdTranscriptScroll";

describe("AssistantWorkSummary scroll hold", () => {
  it("asks the transcript to hold scroll before expanding", () => {
    const hold = vi.fn();
    render(
      <HoldTranscriptScrollProvider value={hold}>
        <AssistantWorkSummary messages={[]}>
          <p>details</p>
        </AssistantWorkSummary>
      </HoldTranscriptScrollProvider>,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(hold).toHaveBeenCalledOnce();
    expect(screen.getByText("details")).toBeTruthy();
  });
});
