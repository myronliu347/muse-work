import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";

export const healthRoutes = new Hono<HonoEnv>();

healthRoutes.get("/health", (c) => c.json({ ok: true }));
