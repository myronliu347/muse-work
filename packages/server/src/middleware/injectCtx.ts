import type { MiddlewareHandler } from "hono";
import type { AppContext } from "../services/appContext.js";
import type { HonoEnv } from "../honoEnv.js";

export function injectCtx(ctx: AppContext): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    c.set("ctx", ctx);
    await next();
  };
}
