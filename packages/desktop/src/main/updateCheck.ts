import type { HotCheckResult } from "./hotUpdate";

export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export type UpdateOffer = {
  kind: "hot" | "installer";
  version: string;
  url?: string;
};

export type UpdatePhase = "idle" | "checking" | "available" | "current" | "failed";

export type UpdateStatus = {
  phase: UpdatePhase;
  offer: UpdateOffer | null;
  detail?: string;
};

/** A failed check keeps an offer that was already found. */
export function statusAfterCheck(prev: UpdateOffer | null, result: HotCheckResult): UpdateStatus {
  if (result.status === "updated") {
    return { phase: "available", offer: { kind: "hot", version: result.version } };
  }
  // Downloaded but not running yet: the restart offer has to survive repeated
  // checks, otherwise the update becomes unreachable until a manual relaunch.
  if (result.status === "restart") {
    return { phase: "available", offer: { kind: "hot", version: result.version } };
  }
  if (result.status === "installer") {
    return {
      phase: "available",
      offer: { kind: "installer", version: result.version, url: result.url },
    };
  }
  if (result.status === "current") return { phase: "current", offer: null };
  if (prev) return { phase: "available", offer: prev, detail: result.reason };
  return { phase: "failed", offer: null, detail: result.reason };
}

export function createUpdateMonitor(opts: {
  check: () => Promise<HotCheckResult>;
  publish: (status: UpdateStatus) => void;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}) {
  let offer: UpdateOffer | null = null;
  let phase: UpdatePhase = "idle";
  let detail: string | undefined;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval;

  const snapshot = (): UpdateStatus => ({ phase, offer, detail });

  async function checkNow(): Promise<void> {
    if (running) return running;
    let finish = () => {};
    running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    phase = "checking";
    detail = undefined;
    opts.publish(snapshot());
    try {
      const next = statusAfterCheck(offer, await opts.check());
      phase = next.phase;
      offer = next.offer;
      detail = next.detail;
    } catch (err) {
      const next = statusAfterCheck(offer, {
        status: "skipped",
        reason: err instanceof Error ? err.message : String(err),
      });
      phase = next.phase;
      offer = next.offer;
      detail = next.detail;
    } finally {
      running = null;
      finish();
      opts.publish(snapshot());
    }
  }

  return {
    start() {
      void checkNow();
      timer = setIntervalFn(() => {
        void checkNow();
      }, opts.intervalMs ?? UPDATE_CHECK_INTERVAL_MS);
    },
    stop() {
      if (timer !== null) clearIntervalFn(timer);
      timer = null;
    },
    checkNow,
    offer: () => offer,
    status: snapshot,
  };
}
