import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// Assign directly (not vi.stubGlobal) so per-test `vi.unstubAllGlobals()`
// calls do not remove it — jsdom has no native ResizeObserver and Radix
// Select/ScrollArea mount one even while closed.
globalThis.ResizeObserver = ResizeObserverStub;

if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

// Suppress console output during tests to reduce noise
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "debug").mockImplementation(() => {});
