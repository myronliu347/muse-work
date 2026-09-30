/** Tracing is a no-op in Muse. */

export function startInteractionSpan(
  ..._args: unknown[]
): void {}

export function endInteractionSpan(): void {}

export function resetTracingState(): void {}

export function startLLMRequestSpan(
  ..._args: unknown[]
): undefined {
  return undefined;
}

export function endLLMRequestSpan(..._args: unknown[]): void {}

export function startToolSpan(..._args: unknown[]): void {}

export function endToolSpan(..._args: unknown[]): void {}
