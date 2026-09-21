/** Max live SDK agents. Extra idle ones are LRU-evicted (runtime only). */
export const AGENT_MAX_LIVE = 20;
/** Abort a running turn after this long with no SDK callbacks. */
export const TURN_STALL_MS = 5 * 60 * 1000;
/** Shown when the SDK finishes a turn without assistant text, tools, or errors. */
export const EMPTY_TURN_ERROR = "模型没有产生输出";
export const DEFAULT_TITLE = "新对话";
export const TITLE_MAX_LEN = 40;
