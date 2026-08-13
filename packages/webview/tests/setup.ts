import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

// Suppress console output during tests to reduce noise
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "debug").mockImplementation(() => {});
