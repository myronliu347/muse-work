/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Message } from "@muse-work/agent";
import {
  UserMessageNav,
  navEntriesFromMessages,
  pickActiveUserMessageId,
} from "../../src/components/message/UserMessageNav";

afterEach(() => {
  cleanup();
});

function userMsg(id: string, text: string, extra?: Partial<Message>): Message {
  return {
    id,
    role: "user",
    timestamp: "0",
    blocks: [{ type: "text", content: text }],
    ...extra,
  };
}

describe("navEntriesFromMessages", () => {
  it("keeps user messages and skips meta / empty / assistant", () => {
    expect(
      navEntriesFromMessages([
        userMsg("u1", "mac 终端启动 iterm2"),
        { id: "a1", role: "assistant", timestamp: "0", blocks: [] },
        { ...userMsg("u-meta", "hidden"), isMeta: true },
        userMsg("u2", "  "),
        userMsg("u3", "open 命令系统内置么"),
      ]),
    ).toEqual([
      { id: "u1", text: "mac 终端启动 iterm2" },
      { id: "u3", text: "open 命令系统内置么" },
    ]);
  });

  it("attaches the last assistant text block to the preceding question", () => {
    const assistant = (
      id: string,
      blocks: Message["blocks"],
    ): Message => ({ id, role: "assistant", timestamp: "0", blocks });

    expect(
      navEntriesFromMessages([
        userMsg("u1", "这个抖动怎么处理"),
        assistant("a1", [
          { type: "text", content: "先看第一段" },
          { type: "text", content: "最后这段是结论" },
        ]),
        userMsg("u2", "接着呢"),
        assistant("a2", [{ type: "text", content: "第二条回复" }]),
      ]),
    ).toEqual([
      { id: "u1", text: "这个抖动怎么处理", reply: "最后这段是结论" },
      { id: "u2", text: "接着呢", reply: "第二条回复" },
    ]);
  });
});

describe("pickActiveUserMessageId", () => {
  const items = [
    { id: "u1", top: 0 },
    { id: "u2", top: 400 },
    { id: "u3", top: 800 },
  ];

  it("keeps the user message at the top of the viewport active", () => {
    expect(
      pickActiveUserMessageId(items, { scrollTop: 0, clientHeight: 900 }),
    ).toBe("u1");
    expect(
      pickActiveUserMessageId(items, { scrollTop: 400, clientHeight: 500 }),
    ).toBe("u2");
    expect(
      pickActiveUserMessageId(items, { scrollTop: 800, clientHeight: 400 }),
    ).toBe("u3");
  });
});

describe("UserMessageNav", () => {
  const entries = [
    { id: "u1", text: "mac 终端启动 iterm2" },
    { id: "u2", text: "open ?" },
    {
      id: "u3",
      text: "能打开终端并且cd 到某个目录吗这是一段很长的用户消息",
    },
  ];

  it("renders a tick per user message and shows one popover on hover", () => {
    render(
      <UserMessageNav entries={entries} activeId="u3" onSelect={() => {}} />,
    );
    expect(screen.getByTestId("user-message-nav")).toBeInTheDocument();
    expect(screen.queryByTestId("user-message-nav-popover")).toBeNull();

    fireEvent.pointerEnter(screen.getByTestId("user-message-nav-u1"));
    const popover = screen.getByTestId("user-message-nav-popover");
    expect(popover).toHaveTextContent("mac 终端启动 iterm2");
    expect(screen.getByTestId("user-message-nav-u1")).toHaveClass(
      "user-message-nav-item--hover",
    );

    fireEvent.pointerEnter(screen.getByTestId("user-message-nav-u3"));
    expect(screen.getByTestId("user-message-nav-popover")).toHaveTextContent(
      "能打开终端并且cd 到某个目录吗这是一段很长的用户消息",
    );
    expect(screen.queryByText("mac 终端启动 iterm2", { selector: ".user-message-nav-popover-user" })).toBeNull();
  });

  it("reveals the full message and scrolls on click", () => {
    const onSelect = vi.fn();
    render(
      <UserMessageNav entries={entries} activeId="u3" onSelect={onSelect} />,
    );
    fireEvent.pointerEnter(screen.getByTestId("user-message-nav-u3"));
    expect(screen.getByTestId("user-message-nav-popover")).toHaveTextContent(
      "能打开终端并且cd 到某个目录吗这是一段很长的用户消息",
    );
    fireEvent.click(screen.getByTestId("user-message-nav-u3"));
    expect(onSelect).toHaveBeenCalledWith("u3");
  });

  it("shows the assistant reply in the popover", () => {
    render(
      <UserMessageNav
        entries={[
          {
            id: "u1",
            text: "这个抖动怎么处理",
            reply: "先看第一段，最后这段是结论",
          },
        ]}
        onSelect={() => {}}
      />,
    );
    fireEvent.pointerEnter(screen.getByTestId("user-message-nav-u1"));
    const popover = screen.getByTestId("user-message-nav-popover");
    expect(popover).toHaveTextContent("这个抖动怎么处理");
    expect(popover).toHaveTextContent("先看第一段，最后这段是结论");
  });

  it("marks the active entry", () => {
    render(
      <UserMessageNav entries={entries} activeId="u3" onSelect={() => {}} />,
    );
    expect(screen.getByTestId("user-message-nav-u3")).toHaveClass(
      "user-message-nav-item--active",
    );
    expect(screen.getByTestId("user-message-nav-u1")).not.toHaveClass(
      "user-message-nav-item--active",
    );
  });
});
