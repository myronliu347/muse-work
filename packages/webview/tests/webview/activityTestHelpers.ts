import { fireEvent } from "./test-utils";

export function expandActivity(root: ParentNode = document) {
  const summary = root.querySelector('[data-testid="activity-summary"]');
  if (
    summary instanceof HTMLElement &&
    summary.getAttribute("aria-expanded") !== "true"
  ) {
    fireEvent.click(summary);
  }
}

export function expandToolDetail(root: ParentNode = document) {
  expandActivity(root);
  const line = root.querySelector(".tool-line.can");
  if (line instanceof HTMLElement) fireEvent.click(line);
}
