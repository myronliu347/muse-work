export function runnerErrorStatus(err: unknown): number {
  const statusCode =
    err && typeof err === "object" && "statusCode" in err
      ? Number((err as { statusCode: number }).statusCode)
      : 500;
  return statusCode || 500;
}

export function runnerErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
