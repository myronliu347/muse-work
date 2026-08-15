import type { MiddlewareHandler } from "hono";
import { getLogger } from "../utils/logger.js";
import type { HonoEnv } from "../honoEnv.js";

export const accessLog: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const start = Date.now();
  await next();
  const meta = {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  };
  if (c.req.path === "/health") {
    getLogger().debug("http", meta);
  } else {
    getLogger().info("http", meta);
  }
};
