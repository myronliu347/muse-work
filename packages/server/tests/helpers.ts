import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { createAppContext, type AppContext } from "../src/services/appContext.js";

export async function listenTestApp(
  options?: { home?: string; ctx?: AppContext },
): Promise<{ server: Server; baseUrl: string; home: string; ctx: AppContext }> {
  const home =
    options?.home ?? fs.mkdtempSync(path.join(os.tmpdir(), "muse-server-"));
  const ctx = options?.ctx ?? createAppContext({ home });
  const server = createApp(ctx);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    home,
    ctx,
  };
}

export async function closeTestApp(
  server: Server,
  home?: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  if (home) {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
