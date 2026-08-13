export type QuitGate = {
  handleBeforeQuit: (event: { preventDefault: () => void }) => void;
};

export function createQuitGate(opts: {
  dispose: () => void;
  stopServer?: () => Promise<void>;
  quit: () => void;
}): QuitGate {
  let quitting = false;
  return {
    handleBeforeQuit(event) {
      if (quitting) return;
      event.preventDefault();
      quitting = true;
      opts.dispose();
      void (async () => {
        try {
          await opts.stopServer?.();
        } finally {
          opts.quit();
        }
      })();
    },
  };
}
