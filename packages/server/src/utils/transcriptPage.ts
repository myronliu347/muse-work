/** A transcript row. Only `id` and compact blocks affect paging. */
export interface PageMessage {
  id: string;
  blocks?: Array<{ type?: string }>;
}

export interface TranscriptPage<T extends PageMessage = PageMessage> {
  messages: T[];
  hasMore: boolean;
}

export const TRANSCRIPT_PAGE_SIZE = 40;
/**
 * Cap on the first page. A long un-compacted session used to open on its
 * entire transcript (hundreds of messages, megabytes of tool output), and the
 * webview had to parse and render all of it before the session switch could
 * finish painting. The tail is what the user lands on; older pages load as
 * they scroll up.
 */
export const TRANSCRIPT_INITIAL_LIMIT = 80;

function isCompact(message: PageMessage): boolean {
  return message.blocks?.some((block) => block.type === "compact") ?? false;
}

function dedupe<T extends PageMessage>(messages: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const message of messages) {
    if (!message?.id || seen.has(message.id)) continue;
    seen.add(message.id);
    out.push(message);
  }
  return out;
}

/**
 * UI window over a session transcript.
 *
 * The first page is the chronological tail from the last compact marker on
 * disk (capped at `TRANSCRIPT_INITIAL_LIMIT`), plus live messages that have not
 * been written yet. Older pages are a slice of the disk transcript immediately
 * before `before`. The caller drops `disk` after this returns — nothing is
 * retained on the agent.
 */
export function pageTranscript<T extends PageMessage>(
  disk: T[],
  live: T[] = [],
  opts?: { before?: string; limit?: number },
): TranscriptPage<T> {
  const history = dedupe(disk);
  const limit =
    opts?.limit && opts.limit > 0 ? Math.floor(opts.limit) : TRANSCRIPT_PAGE_SIZE;

  if (opts?.before) {
    const index = history.findIndex((message) => message.id === opts.before);
    if (index <= 0) return { messages: [], hasMore: false };
    const start = Math.max(0, index - limit);
    return {
      messages: history.slice(start, index),
      hasMore: start > 0,
    };
  }

  let lastCompact = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (isCompact(history[i])) {
      lastCompact = i;
      break;
    }
  }
  const fullTail = lastCompact >= 0 ? history.slice(lastCompact) : history;
  const start = Math.max(0, fullTail.length - TRANSCRIPT_INITIAL_LIMIT);
  const tail = fullTail.slice(start);
  const known = new Set(history.map((message) => message.id));
  const unsaved = dedupe(live).filter((message) => !known.has(message.id));
  return {
    messages: [...tail, ...unsaved],
    hasMore: start > 0 || lastCompact > 0,
  };
}
