/** Pierre hardcodes these English collapsed-context labels. */
export function localizeUnmodifiedLineLabel(text: string): string | null {
  const count = /^(\d+) unmodified lines?$/.exec(text);
  if (count) return `${count[1]} 行未修改`;
  if (text === "More unchanged context may be available") {
    return "可能还有未改动的内容";
  }
  if (text === "Expand all") return "全部展开";
  return null;
}

export function localizeDiffSeparatorLabels(root: ParentNode): void {
  root
    .querySelectorAll("[data-unmodified-lines], [data-expand-all-button]")
    .forEach((node) => {
      const next = localizeUnmodifiedLineLabel(node.textContent ?? "");
      if (next) node.textContent = next;
    });
}

export function localizeDiffHost(host: HTMLElement): void {
  localizeDiffSeparatorLabels(host);
  if (host.shadowRoot) localizeDiffSeparatorLabels(host.shadowRoot);
}
