/** Telemetry is a no-op in Muse. */

export async function logOTelEvent(
  _name?: string,
  _attributes?: Record<string, string>,
): Promise<void> {}
