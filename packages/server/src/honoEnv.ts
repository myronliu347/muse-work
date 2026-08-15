import type { AppContext } from "./services/appContext.js";

export type HonoEnv = {
  Variables: {
    ctx: AppContext;
  };
};
