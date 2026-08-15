/**
 * Map SDK agent messages to a JSON-serializable UI snapshot.
 * MVP: pass through plain objects; drop non-serializable fields.
 */
export function mapSdkMessages(messages: unknown[]): unknown[] {
  return messages.map((message) => sanitize(message));
}

function sanitize(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "function" || typeof child === "symbol") {
      continue;
    }
    out[key] = sanitize(child, seen);
  }
  return out;
}
