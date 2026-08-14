export type QuitGate = {
  setAgentBusy: (busy: boolean) => void;
  isAgentBusy: () => boolean;
  handleBeforeQuit: (event: { preventDefault: () => void }) => void;
  /** Intercept window close while the agent is busy (e.g. clicking the red traffic light). */
  handleWindowClose: (event: { preventDefault: () => void }) => void;
};

export type CreateQuitGateOpts = {
  dispose: () => void;
  stopServer?: () => Promise<void>;
  quit: () => void;
  /**
   * Ask the user whether to quit while the agent is running.
   * Return `true` to proceed (abort + quit), `false` to stay open.
   */
  confirmQuitWhileBusy: () => Promise<boolean>;
  /** Best-effort abort of in-flight turns before tearing down the server. */
  prepareQuit?: () => Promise<void>;
};

/**
 * Coordinates app quit: confirm when the agent is busy, then dispose hosts,
 * stop muse-server, and call `quit` once.
 */
export function createQuitGate(opts: CreateQuitGateOpts): QuitGate {
  let quitting = false;
  let agentBusy = false;
  let confirming = false;
  let busyQuitApproved = false;

  const runGracefulQuit = (): void => {
    if (quitting) return;
    quitting = true;
    opts.dispose();
    void (async () => {
      try {
        await opts.stopServer?.();
      } finally {
        opts.quit();
      }
    })();
  };

  const confirmThenQuit = (): void => {
    if (quitting || confirming) return;
    confirming = true;
    void (async () => {
      try {
        const ok = await opts.confirmQuitWhileBusy();
        if (!ok) return;
        busyQuitApproved = true;
        try {
          await opts.prepareQuit?.();
        } catch {
          // Abort is best-effort; still quit.
        }
        opts.quit();
      } finally {
        confirming = false;
      }
    })();
  };

  return {
    setAgentBusy(busy) {
      agentBusy = busy;
    },
    isAgentBusy() {
      return agentBusy;
    },
    handleBeforeQuit(event) {
      if (quitting) return;

      if (agentBusy && !busyQuitApproved) {
        event.preventDefault();
        confirmThenQuit();
        return;
      }

      event.preventDefault();
      runGracefulQuit();
    },
    handleWindowClose(event) {
      if (quitting) return;
      if (!agentBusy) return;
      if (busyQuitApproved) return;
      event.preventDefault();
      confirmThenQuit();
    },
  };
}
