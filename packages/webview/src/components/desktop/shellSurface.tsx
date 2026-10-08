import { createContext, useContext } from "react";

export type ShellSurface = "chat" | "automations" | "assistant";

const ShellSurfaceContext = createContext<ShellSurface>("chat");

export const ShellSurfaceProvider = ShellSurfaceContext.Provider;

export function useShellSurface(): ShellSurface {
  return useContext(ShellSurfaceContext);
}
