export type PreviewImage = { url: string; alt: string };

/** 全屏看图。同一条消息有多张时可以左右切换。返回的函数可重复调用，用来关掉预览。 */
export function openImagePreview(
  url: string,
  alt: string,
  gallery?: PreviewImage[],
  startIndex?: number,
): () => void {
  const images = gallery && gallery.length > 0 ? gallery : [{ url, alt }];
  let index = startIndex ?? images.findIndex((item) => item.url === url);
  if (index < 0 || index >= images.length) index = 0;

  const modal = document.createElement("div");
  modal.className = "image-preview-modal";

  let closed = false;
  const img = document.createElement("img");
  img.src = images[index].url;
  img.alt = images[index].alt;
  img.onclick = (event) => event.stopPropagation();
  let counter: HTMLDivElement | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    modal.remove();
  };

  const show = (next: number) => {
    index = (next + images.length) % images.length;
    img.src = images[index].url;
    img.alt = images[index].alt;
    if (counter) counter.textContent = `${index + 1} / ${images.length}`;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (images.length < 2) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    show(index + (event.key === "ArrowRight" ? 1 : -1));
  };

  modal.onclick = close;

  const closeBtn = document.createElement("div");
  closeBtn.className = "image-preview-close";
  closeBtn.innerHTML = '<i class="codicon codicon-close"></i>';
  closeBtn.onclick = (event) => {
    event.stopPropagation();
    close();
  };

  modal.appendChild(img);
  modal.appendChild(closeBtn);
  if (images.length > 1) {
    for (const [side, delta, label] of [
      ["prev", -1, "上一张"],
      ["next", 1, "下一张"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `image-preview-nav image-preview-nav--${side}`;
      button.setAttribute("aria-label", label);
      button.innerHTML = `<i class="codicon codicon-chevron-${side === "prev" ? "left" : "right"}"></i>`;
      button.onclick = (event) => {
        event.stopPropagation();
        show(index + delta);
      };
      modal.appendChild(button);
    }
    counter = document.createElement("div");
    counter.className = "image-preview-count";
    counter.textContent = `${index + 1} / ${images.length}`;
    modal.appendChild(counter);
  }
  document.body.appendChild(modal);
  document.addEventListener("keydown", onKeyDown, true);
  return close;
}
