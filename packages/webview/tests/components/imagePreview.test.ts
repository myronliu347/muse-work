/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { openImagePreview } from "../../src/components/message/imagePreview";

function removeOverlayHost() {
  document.getElementById("muse-overlay-root")?.remove();
}

describe("openImagePreview", () => {
  afterEach(() => {
    removeOverlayHost();
    document.querySelectorAll(".image-preview-modal").forEach((el) => el.remove());
  });

  it("mounts inside the theme overlay host so the scrim tokens resolve", () => {
    // The scrim and control colors are Radix tokens defined on .radix-themes;
    // a body-level modal sits outside them and paints with a transparent scrim.
    const host = document.createElement("div");
    host.id = "muse-overlay-root";
    document.body.appendChild(host);

    const close = openImagePreview("file:///tmp/shot.png", "shot");

    const modal = host.querySelector(".image-preview-modal");
    expect(modal).toBeTruthy();
    expect(modal!.parentElement).toBe(host);
    close();
    expect(document.querySelector(".image-preview-modal")).toBeNull();
  });

  it("is a dialog with a focusable close button and restores focus", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const close = openImagePreview("file:///tmp/shot.png", "shot");
    const modal = document.querySelector(".image-preview-modal")!;
    expect(modal.getAttribute("role")).toBe("dialog");
    expect(modal.getAttribute("aria-modal")).toBe("true");

    const closeBtn = modal.querySelector(".image-preview-close") as HTMLElement;
    expect(closeBtn.tagName).toBe("BUTTON");
    expect(closeBtn.getAttribute("aria-label")).toBe("关闭图片预览");
    expect(document.activeElement).toBe(closeBtn);

    close();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("closes on Escape", () => {
    openImagePreview("file:///tmp/shot.png", "shot");
    expect(document.querySelector(".image-preview-modal")).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".image-preview-modal")).toBeNull();
  });

  it("falls back to the body when the app has no overlay host", () => {
    const close = openImagePreview("file:///tmp/shot.png", "shot");
    const modal = document.querySelector(".image-preview-modal");
    expect(modal?.parentElement).toBe(document.body);
    close();
  });
});
