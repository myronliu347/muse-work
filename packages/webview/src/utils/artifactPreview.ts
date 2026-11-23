import { resolveWorkspaceFilePath } from "./filePathDisplay";
import { fileBaseName, fileLinkKind } from "./fileLinkKind";
import { resolveImageSrc } from "./resolveImageSrc";

export interface ArtifactPreviewImage {
  url: string;
  alt: string;
}

/**
 * Image gallery for the 产物 chips. Every image in the group can be reached
 * with the preview's ←/→ controls, starting from the chip that was clicked;
 * non-image artifacts keep their own open behavior and are skipped.
 */
export function artifactImageGallery(
  path: string,
  gallery: string[] | undefined,
  workdir?: string,
): { images: ArtifactPreviewImage[]; index: number } {
  const imagePaths = (gallery ?? []).filter(
    (candidate) => fileLinkKind(candidate) === "image",
  );
  // A caller that does not know the sibling artifacts still gets a one-image
  // preview of the clicked shot.
  if (fileLinkKind(path) === "image" && !imagePaths.includes(path)) {
    imagePaths.unshift(path);
  }
  const images = imagePaths.map((candidate) => {
    const resolved = resolveWorkspaceFilePath(candidate, workdir);
    return { url: resolveImageSrc(resolved), alt: fileBaseName(resolved) };
  });
  const clickedUrl = resolveImageSrc(resolveWorkspaceFilePath(path, workdir));
  const found = images.findIndex((image) => image.url === clickedUrl);
  return { images, index: found < 0 ? 0 : found };
}
