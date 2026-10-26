import { createContext, useContext } from "react";

export type ShellSurface = "assistant" | "sessions" | "automations" | "skills" | "settings";

const ShellSurfaceContext = createContext<ShellSurface | null>(null);

export const ShellSurfaceProvider = ShellSurfaceContext.Provider;

/** Shell page. Without a provider this is the default home, Muse Bot. */
export function useShellSurface(): ShellSurface {
  return useContext(ShellSurfaceContext) ?? "assistant";
}

/**
 * The surface a parent shell actually published.
 * Null when this tree is a bare pane, which stays on chat.
 */
export function useProvidedShellSurface(): ShellSurface | null {
  return useContext(ShellSurfaceContext);
}
