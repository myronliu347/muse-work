import fs from "node:fs";

type Block = Record<string, unknown>;

/** Absolute filesystem path (POSIX or Windows), not a URL scheme. */
function isFilesystemPath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

function defaultExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    // An unreadable path should stay in the transcript rather than silently
    // disappear; the renderer can still decide how to paint it.
    return true;
  }
}

/**
 * Drop transcript image refs whose upload file is gone, and count them so the
 * UI can show a「图片已清理」placeholder.
 *
 * Attachments live in the OS temp dir (`.../T/muse-work/uploads/<id>.png`).
 * The transcript keeps the absolute path forever, so once macOS or the app
 * cleans the temp dir, every open of that message still points an `<img>` at a
 * missing file and the renderer logs a failed `file:` request. Removing those
 * refs avoids the requests; `data:`, `file:`, http(s) and other URL refs are
 * left untouched. A block whose refs all vanished is kept with an empty
 * `imageUrls` plus `missingImageCount` so the placeholder still renders.
 *
 * History loads and live `messages:replace` pushes both go through here.
 */
export function pruneMissingImageRefs<T>(
  messages: T[],
  exists: (filePath: string) => boolean = defaultExists,
): T[] {
  let listChanged = false;
  const next = messages.map((message) => {
    const blocks = (message as { blocks?: Block[] } | null)?.blocks;
    if (!Array.isArray(blocks) || blocks.length === 0) return message;
    let blocksChanged = false;
    const nextBlocks: Block[] = [];
    for (const block of blocks) {
      if (
        !block ||
        block.type !== "image" ||
        !Array.isArray(block.imageUrls)
      ) {
        nextBlocks.push(block);
        continue;
      }
      let missing = 0;
      const urls = block.imageUrls.filter((url): url is string => {
        if (typeof url !== "string") return false;
        if (!isFilesystemPath(url) || exists(url)) return true;
        missing++;
        return false;
      });
      if (missing === 0) {
        nextBlocks.push(block);
        continue;
      }
      blocksChanged = true;
      const previousMissing =
        typeof block.missingImageCount === "number" && block.missingImageCount > 0
          ? block.missingImageCount
          : 0;
      // Keep the block even when `urls` is empty: the renderer turns
      // `missingImageCount` into a「图片已清理」placeholder.
      nextBlocks.push({
        ...block,
        imageUrls: urls,
        missingImageCount: previousMissing + missing,
      });
    }
    if (!blocksChanged) return message;
    listChanged = true;
    return { ...(message as object), blocks: nextBlocks } as T;
  });
  return listChanged ? next : messages;
}
