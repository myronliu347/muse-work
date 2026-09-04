/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PopoUiProvider, usePopoUi } from "../../../src/components/popo/popoUi";
import type { MuseApiClient, PopoChatSummary } from "../../../src/muse/apiClient";

function List() {
  const { chats, enabled } = usePopoUi();
  if (!enabled) return <div>off</div>;
  return (
    <ul>
      {chats.map((c) => (
        <li key={c.chatKey}>{c.title}</li>
      ))}
    </ul>
  );
}

function chat(partial: Partial<PopoChatSummary> & Pick<PopoChatSummary, "chatKey" | "title">): PopoChatSummary {
  return {
    type: "team",
    lastMessage: "",
    processing: false,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("PopoUiProvider", () => {
  it("refreshes the chat list when popo:changed arrives", async () => {
    const listPopoChats = vi
      .fn()
      .mockResolvedValueOnce({
        chats: [chat({ chatKey: "p2p:old", title: "old@corp", type: "p2p" })],
      })
      .mockResolvedValueOnce({
        chats: [
          chat({ chatKey: "team:new", title: "群 999" }),
          chat({ chatKey: "p2p:old", title: "old@corp", type: "p2p" }),
        ],
      });
    const api = {
      getPopoConfig: vi.fn().mockResolvedValue({ configured: true }),
      listPopoChats,
    } as unknown as MuseApiClient;

    render(
      <PopoUiProvider api={api}>
        <List />
      </PopoUiProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("old@corp")).toBeInTheDocument();
    });
    expect(screen.queryByText("群 999")).toBeNull();

    window.dispatchEvent(
      new MessageEvent("message", { data: { command: "popo:changed" } }),
    );

    await waitFor(() => {
      expect(screen.getByText("群 999")).toBeInTheDocument();
    });
    expect(listPopoChats).toHaveBeenCalledTimes(2);
  });
});
