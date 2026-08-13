/** Fired after provider settings are saved so model selectors can refresh. */
export const MUSE_PROVIDERS_CHANGED_EVENT = "muse:providers-changed";

export function notifyProvidersChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MUSE_PROVIDERS_CHANGED_EVENT));
}
