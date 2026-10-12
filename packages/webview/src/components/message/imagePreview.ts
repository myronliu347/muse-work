/** 全屏看一张图。返回的函数可重复调用，用来关掉预览。 */
export function openImagePreview(url: string, alt: string): () => void {
  const modal = document.createElement("div");
  modal.className = "image-preview-modal";

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    modal.remove();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  modal.onclick = close;

  const img = document.createElement("img");
  img.src = url;
  img.alt = alt;
  img.onclick = (event) => event.stopPropagation();

  const closeBtn = document.createElement("div");
  closeBtn.className = "image-preview-close";
  closeBtn.innerHTML = '<i class="codicon codicon-close"></i>';
  closeBtn.onclick = (event) => {
    event.stopPropagation();
    close();
  };

  modal.appendChild(img);
  modal.appendChild(closeBtn);
  document.body.appendChild(modal);
  document.addEventListener("keydown", onKeyDown, true);
  return close;
}
