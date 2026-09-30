/** Telemetry is a no-op in Muse; Wave OTLP exporters were removed. */

export type TelemetryConfig = Record<string, unknown>;

export function resolveTelemetryConfig(
  _input?: unknown,
): TelemetryConfig | undefined {
  return undefined;
}

export async function initializeTelemetry(
  _config?: unknown,
): Promise<void> {}

export async function shutdownTelemetry(): Promise<void> {}

export function getOTELApi(): undefined {
  return undefined;
}

export function getCurrentConfig(): TelemetryConfig | undefined {
  return undefined;
}

export function isInitialized(): boolean {
  return false;
}

export function getTelemetryAttributes(): Record<string, string> {
  return {};
}
