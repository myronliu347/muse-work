import type { IncomingMessage, ServerResponse } from "node:http";

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendError(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  sendJson(res, status, { error: message });
}

export async function readJsonBody(
  req: IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as unknown;
}
