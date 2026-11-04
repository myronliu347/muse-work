const HIDE_AFTER_MS = 700;

/** Reveal a scrollbar thumb only while its element is scrolling. */
export function installScrollingScrollbars(): () => void {
  const timers = new WeakMap<Element, number>();
  const active = new Set<Element>();

  const onScroll = (event: Event) => {
    const raw = event.target;
    const el =
      raw === document || raw === document.body
        ? document.documentElement
        : raw;
    if (!(el instanceof Element)) return;

    el.setAttribute("data-scrolling", "");
    active.add(el);
    const prev = timers.get(el);
    if (prev !== undefined) window.clearTimeout(prev);
    timers.set(
      el,
      window.setTimeout(() => {
        el.removeAttribute("data-scrolling");
        timers.delete(el);
        active.delete(el);
      }, HIDE_AFTER_MS),
    );
  };

  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    document.removeEventListener("scroll", onScroll, true);
    for (const el of active) {
      const timer = timers.get(el);
      if (timer !== undefined) window.clearTimeout(timer);
      el.removeAttribute("data-scrolling");
    }
    active.clear();
  };
}
