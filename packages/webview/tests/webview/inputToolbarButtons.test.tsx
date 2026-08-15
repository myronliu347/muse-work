import { renderChatApp, screen, fireEvent } from "./test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("Input toolbar buttons (+)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should open the "+" menu with an 上传文件 item when clicking the add button', async () => {
    renderChatApp();

    const addButton = screen.getByLabelText("添加");
    fireEvent.click(addButton);

    const menu = document.querySelector(".plus-menu");
    expect(menu).toBeInTheDocument();

    const uploadItem = document.querySelector(".plus-menu-item");
    expect(uploadItem).toBeInTheDocument();
    expect(uploadItem).toHaveTextContent(/上传文件/);
  });

  it("should trigger the hidden file input when clicking 上传文件", async () => {
    renderChatApp();

    // handleFileUpload() creates a hidden <input type=file> and calls .click().
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});

    const addButton = screen.getByLabelText("添加");
    fireEvent.click(addButton);

    const uploadItem = document.querySelector(".plus-menu-item") as HTMLElement;
    expect(uploadItem).toBeInTheDocument();
    fireEvent.click(uploadItem);

    expect(clickSpy).toHaveBeenCalled();
  });
});
