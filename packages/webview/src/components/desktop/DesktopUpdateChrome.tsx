import React, { useEffect, useState } from "react";
import {
  postDesktopCommand,
  updateStatusText,
  useDesktopUpdateStatus,
} from "../../desktop/updateStatus";

/** Settings-header actions. The check stays a normal header button; 更新 appears beside it. */
export function DesktopUpdateChrome() {
  const status = useDesktopUpdateStatus();
  const [pending, setPending] = useState(false);
  const checking = pending || status.phase === "checking";

  useEffect(() => {
    if (!pending) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { command?: string; phase?: string } | null;
      if (data?.command !== "desktopUpdateStatus") return;
      if (data.phase && data.phase !== "checking") setPending(false);
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => setPending(false), 25_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [pending]);

  return (
    <div className="desktop-settings-update" data-testid="desktop-update-chrome">
      {checking || status.phase !== "idle" ? (
        <span className="desktop-settings-update-status" role="status" data-testid="update-status-text">
          {checking ? "正在检查…" : updateStatusText(status)}
        </span>
      ) : null}
      <button
        type="button"
        className="desktop-settings-update-check"
        disabled={checking}
        data-testid="check-for-update-btn"
        onClick={() => {
          setPending(true);
          postDesktopCommand("desktopCheckForUpdate");
        }}
      >
        {checking ? "正在检查…" : "检查更新"}
      </button>
    </div>
  );
}
