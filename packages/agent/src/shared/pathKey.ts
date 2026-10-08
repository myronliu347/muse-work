import path from "path";

export function resolveWorkdirKey(workdir: string): string {
  return path.resolve(workdir);
}
