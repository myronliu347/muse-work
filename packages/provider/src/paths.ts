import os from "node:os";
import path from "node:path";

export function getMuseHomeDir(home = os.homedir()): string {
  return path.join(home, ".muse-work");
}

export function getProvidersConfigPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "providers.json");
}

export function getCodeMakerAuthPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "auth", "codemaker.json");
}

export function getSharedCodeMakerAuthPath(home = os.homedir()): string {
  return path.join(home, ".local", "share", "codemaker", "auth.json");
}
