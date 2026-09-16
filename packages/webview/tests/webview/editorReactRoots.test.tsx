/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "../../src/components/shared/Tooltip";
import {
  renderInEditorHost,
  unmountDisconnectedEditorHosts,
  unmountEditorHostsIn,
} from "../../src/utils/editorReactRoots";

describe("editor React chip roots", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("unmounts portaled tooltips when the editor host is wiped", async () => {
    const editor = document.createElement("div");
    document.body.appendChild(editor);
    const host = document.createElement("span");
    editor.appendChild(host);

    renderInEditorHost(
      host,
      <Tooltip text="点击查看 leaked.md">
        <span>leaked.md</span>
      </Tooltip>,
    );

    await waitFor(() => {
      expect(host.querySelector(".tooltip-container")).not.toBeNull();
    });
    fireEvent.mouseEnter(host.querySelector(".tooltip-container") as HTMLElement);
    await waitFor(() => {
      expect(document.querySelector(".tooltip-box.visible")).not.toBeNull();
    });

    editor.innerHTML = "";

    await waitFor(() => {
      expect(document.querySelector(".tooltip-box.visible")).toBeNull();
    });

    act(() => {
      unmountDisconnectedEditorHosts();
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("unmountEditorHostsIn clears chips still attached to the editor", async () => {
    const editor = document.createElement("div");
    document.body.appendChild(editor);
    const host = document.createElement("span");
    editor.appendChild(host);
    renderInEditorHost(
      host,
      <Tooltip text="chip">
        <span>chip</span>
      </Tooltip>,
    );
    await waitFor(() => {
      expect(host.querySelector(".tooltip-container")).not.toBeNull();
    });
    fireEvent.mouseEnter(host.querySelector(".tooltip-container") as HTMLElement);
    await waitFor(() => {
      expect(document.querySelector(".tooltip-box.visible")).not.toBeNull();
    });

    act(() => {
      unmountEditorHostsIn(editor);
    });
    expect(document.querySelector(".tooltip-box.visible")).toBeNull();
  });
});
