import { describe, expect, it } from "vitest";
import { artifactImageGallery } from "../../src/utils/artifactPreview";

const artifacts = [
  "/work/report.html",
  "/work/a.png",
  "/work/notes.md",
  "/work/b.png",
];

describe("artifactImageGallery", () => {
  it("collects every image in display order and starts at the clicked one", () => {
    const { images, index } = artifactImageGallery("/work/b.png", artifacts);

    expect(images.map((image) => image.alt)).toEqual(["a.png", "b.png"]);
    expect(index).toBe(1);
  });

  it("resolves relative artifact paths against the workdir", () => {
    const { images, index } = artifactImageGallery(
      "shots/b.png",
      ["shots/a.png", "report.html", "shots/b.png"],
      "/work/radii",
    );

    expect(images.map((image) => image.alt)).toEqual(["a.png", "b.png"]);
    expect(images[0].url).toMatch(/\/work\/radii\/shots\/a\.png$/);
    expect(index).toBe(1);
  });

  it("still previews a single image when no sibling list is known", () => {
    const { images, index } = artifactImageGallery("/work/a.png", undefined);

    expect(images).toHaveLength(1);
    expect(images[0].alt).toBe("a.png");
    expect(index).toBe(0);
  });

  it("prepends the clicked image when the gallery does not contain it", () => {
    const { images, index } = artifactImageGallery("/work/c.png", [
      "/work/a.png",
      "/work/report.html",
    ]);

    expect(images.map((image) => image.alt)).toEqual(["c.png", "a.png"]);
    expect(index).toBe(0);
  });
});
