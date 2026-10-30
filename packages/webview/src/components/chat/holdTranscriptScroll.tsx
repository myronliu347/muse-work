import { createContext, useContext } from "react";

const HoldTranscriptScrollContext = createContext<() => void>(() => {});

export const HoldTranscriptScrollProvider = HoldTranscriptScrollContext.Provider;

/** Call before a disclosure toggle so the transcript does not jump to the end. */
export function useHoldTranscriptScroll(): () => void {
  return useContext(HoldTranscriptScrollContext);
}
