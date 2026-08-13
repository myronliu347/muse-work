export const DEFAULT_HEALTH_INTERVAL_MS = 5_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
export const DEFAULT_HEALTH_FAIL_THRESHOLD = 3;

export type HealthWatch = {
  start: () => void;
  stop: () => void;
  probeNow: () => Promise<boolean>;
};

export type CreateHealthWatchOpts = {
  getUrl: () => string;
  intervalMs?: number;
  timeoutMs?: number;
  failThreshold?: number;
  fetch?: typeof fetch;
  schedule?: (
    fn: () => void | Promise<void>,
    ms: number,
  ) => ReturnType<typeof setInterval>;
  clearSchedule?: typeof clearInterval;
  onUnhealthy: () => void;
};

export function createHealthWatch(opts: CreateHealthWatchOpts): HealthWatch {
  const intervalMs = opts.intervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const failThreshold = opts.failThreshold ?? DEFAULT_HEALTH_FAIL_THRESHOLD;
  const fetchImpl = opts.fetch ?? fetch;
  const schedule = opts.schedule ?? setInterval;
  const clearSchedule = opts.clearSchedule ?? clearInterval;

  let timer: ReturnType<typeof setInterval> | number | null = null;
  let failures = 0;
  let probing = false;

  const probeNow = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(opts.getUrl(), { signal: controller.signal });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  const tick = async (): Promise<void> => {
    if (probing) return;
    probing = true;
    try {
      const ok = await probeNow();
      if (ok) {
        failures = 0;
        return;
      }
      failures += 1;
      if (failures >= failThreshold) {
        failures = 0;
        opts.onUnhealthy();
      }
    } finally {
      probing = false;
    }
  };

  return {
    start() {
      if (timer !== null) return;
      failures = 0;
      timer = schedule(() => tick(), intervalMs);
    },
    stop() {
      if (timer === null) return;
      clearSchedule(timer);
      timer = null;
      failures = 0;
    },
    probeNow,
  };
}
