/** CSS-pixel frames for the preview guest. Sizes match common device viewports. */

export type PreviewDevice = {
  id: string;
  label: string;
  width: number;
  height: number;
};

export const PREVIEW_DEVICES: readonly PreviewDevice[] = [
  { id: "iphone-16e", label: "iPhone 16e", width: 390, height: 844 },
  { id: "iphone-17", label: "iPhone 17", width: 402, height: 874 },
  { id: "iphone-17-pro-max", label: "iPhone 17 Pro Max", width: 440, height: 956 },
  { id: "pixel-10", label: "Pixel 10", width: 412, height: 923 },
  { id: "galaxy-s25-ultra", label: "Galaxy S25 Ultra", width: 384, height: 832 },
  { id: "ipad-mini", label: "iPad mini", width: 744, height: 1133 },
  { id: "ipad-air-11", label: 'iPad Air 11"', width: 820, height: 1180 },
  { id: "ipad-pro-13", label: 'iPad Pro 13"', width: 1032, height: 1376 },
  { id: "laptop", label: "Laptop", width: 1366, height: 768 },
  { id: "desktop", label: "Desktop", width: 1920, height: 1080 },
];

const MIN_DIMENSION = 200;
const MAX_DIMENSION = 3840;

/** Match a preset in either orientation. */
export function matchPreviewDevice(width: number, height: number): PreviewDevice | null {
  return (
    PREVIEW_DEVICES.find(
      (device) =>
        (device.width === width && device.height === height) ||
        (device.width === height && device.height === width),
    ) ?? null
  );
}

export function parsePreviewDimension(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  if (value < MIN_DIMENSION || value > MAX_DIMENSION) return null;
  return value;
}

/** Scale a frame down so it fits the stage. Unmeasured stages stay at 1:1. */
export function previewViewportScale(
  frame: { width: number; height: number },
  stage: { width: number; height: number },
  pad = 16,
): number {
  if (stage.width <= 0 || stage.height <= 0) return 1;
  if (frame.width <= 0 || frame.height <= 0) return 1;
  const availW = Math.max(1, stage.width - pad * 2);
  const availH = Math.max(1, stage.height - pad * 2);
  return Math.min(1, availW / frame.width, availH / frame.height);
}
