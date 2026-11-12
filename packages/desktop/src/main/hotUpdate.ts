/**
 * Hot resources (webview + muse-server) live under userData and override the
 * copies shipped inside the app. The Electron shell stays put.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HOT_REPO = "myronliu347/muse-work";
export const HOT_MANIFEST_NAME = "muse-hot.json";
export const HOT_ZIP_NAME = "muse-hot.zip";

/** Release files, not api.github.com. The anonymous REST quota is 60/hour per IP. */
export function releaseAssetUrl(repo: string, name: string): string {
  return `https://github.com/${repo}/releases/latest/download/${name}`;
}

/** electron-builder names the dmg from the release version, not shellVersion. */
export function installerAssetName(version: string, arch: string): string {
  return `Muse-${normalizeVersion(version)}-${arch}.dmg`;
}

export type HotManifest = {
  version: string;
  shell: string;
  sha256: string;
  asset: string;
};

export type LaunchResources = {
  webviewHtmlPath: string;
  serverEntry: string;
  source: "hot" | "bundled";
  version: string;
};

type ReleaseAsset = { name?: string; browser_download_url?: string };
type ReleaseResponse = { html_url?: string; assets?: ReleaseAsset[] };

function parseVersion(raw: string): [number, number, number] | null {
  const match = raw.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function normalizeVersion(raw: string): string {
  const parts = parseVersion(raw);
  if (!parts) return raw.trim().replace(/^v/, "");
  return parts.join(".");
}

/** Positive when `a` is newer than `b`. Unparseable versions sort as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? [0, 0, 0];
  const right = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function parseHotManifest(raw: unknown): HotManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.version !== "string" || !parseVersion(row.version)) return null;
  if (typeof row.shell !== "string" || !row.shell.trim()) return null;
  if (typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(row.sha256)) return null;
  if (row.asset !== HOT_ZIP_NAME) return null;
  return {
    version: normalizeVersion(row.version),
    shell: row.shell.trim(),
    sha256: row.sha256.toLowerCase(),
    asset: HOT_ZIP_NAME,
  };
}

export function readBundledHot(
  resourcesPath: string,
): { version: string; shell: string | null } | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(resourcesPath, "bundled-hot.json"), "utf8"),
    ) as { version?: unknown; shell?: unknown };
    if (typeof raw.version !== "string" || !parseVersion(raw.version)) return null;
    const shell =
      typeof raw.shell === "string" && parseVersion(raw.shell) ? normalizeVersion(raw.shell) : null;
    return { version: normalizeVersion(raw.version), shell };
  } catch {
    return null;
  }
}

export function readBundledHotVersion(resourcesPath: string): string | null {
  return readBundledHot(resourcesPath)?.version ?? null;
}

/** Shell baked into this build. The dmg version (app.getVersion) tracks each release. */
export function readShellVersion(packageJsonPath: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { shellVersion?: unknown };
    if (typeof pkg.shellVersion !== "string" || !parseVersion(pkg.shellVersion)) return null;
    return normalizeVersion(pkg.shellVersion);
  } catch {
    return null;
  }
}

export function hotLayoutError(dir: string): string | null {
  if (!fs.existsSync(path.join(dir, "webview", "index.html"))) return "missing webview";
  if (!fs.existsSync(path.join(dir, "muse-server", "dist", "index.js"))) {
    return "missing server";
  }
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "muse-server", "package.json"), "utf8"),
    ) as { name?: unknown };
    if (pkg.name !== "@muse-work/server") return "server package";
  } catch {
    return "server package";
  }
  return null;
}

function currentFile(hotRoot: string): string {
  return path.join(hotRoot, "current.json");
}

function versionDir(hotRoot: string, version: string): string {
  return path.join(hotRoot, "versions", version);
}

function readCurrentVersion(hotRoot: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(currentFile(hotRoot), "utf8")) as {
      version?: unknown;
    };
    if (typeof raw.version !== "string" || !parseVersion(raw.version)) return null;
    return normalizeVersion(raw.version);
  } catch {
    return null;
  }
}

export function discardActiveHot(hotRoot: string): void {
  const version = readCurrentVersion(hotRoot);
  fs.rmSync(currentFile(hotRoot), { force: true });
  if (version) fs.rmSync(versionDir(hotRoot, version), { recursive: true, force: true });
}

export function resolveLaunchResources(opts: {
  hotRoot: string;
  bundled: { webviewHtmlPath: string; serverEntry: string; version: string };
}): LaunchResources {
  const bundled: LaunchResources = {
    webviewHtmlPath: opts.bundled.webviewHtmlPath,
    serverEntry: opts.bundled.serverEntry,
    source: "bundled",
    version: normalizeVersion(opts.bundled.version),
  };
  const version = readCurrentVersion(opts.hotRoot);
  if (!version || compareVersions(version, bundled.version) <= 0) return bundled;
  const dir = versionDir(opts.hotRoot, version);
  if (hotLayoutError(dir)) {
    discardActiveHot(opts.hotRoot);
    return bundled;
  }
  return {
    webviewHtmlPath: path.join(dir, "webview", "index.html"),
    serverEntry: path.join(dir, "muse-server", "dist", "index.js"),
    source: "hot",
    version,
  };
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function extractZip(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn("ditto", ["-x", "-k", zipPath, destDir], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ditto exited ${code ?? "null"}`));
    });
  });
}

export type HotCheckResult =
  | { status: "updated"; version: string }
  /** A newer tree is already on disk but this process still runs the old one. */
  | { status: "restart"; version: string }
  | { status: "installer"; version: string; shell: string; url: string }
  | { status: "current" }
  | { status: "skipped"; reason: string };

function highestVersion(versions: string[]): string {
  return versions.reduce((best, version) => (compareVersions(version, best) > 0 ? version : best));
}

/** Prefer this machine's arch, then a lone dmg, then the release page. */
export function pickInstallerUrl(
  release: ReleaseResponse,
  arch: string,
  fallback: string,
): string {
  const dmgs = (release.assets ?? []).filter(
    (item): item is { name: string; browser_download_url: string } =>
      typeof item.name === "string" &&
      item.name.endsWith(".dmg") &&
      typeof item.browser_download_url === "string",
  );
  const matched = dmgs.find((item) => item.name.includes(arch));
  if (matched) return matched.browser_download_url;
  if (dmgs.length === 1) return dmgs[0].browser_download_url;
  if (typeof release.html_url === "string" && release.html_url) return release.html_url;
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function writeCurrent(hotRoot: string, version: string): void {
  fs.mkdirSync(hotRoot, { recursive: true });
  fs.writeFileSync(currentFile(hotRoot), `${JSON.stringify({ version })}\n`);
}

function pruneVersions(hotRoot: string, keep: string): void {
  const root = path.join(hotRoot, "versions");
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    if (name === keep) continue;
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
}

export async function checkForHotUpdate(opts: {
  hotRoot: string;
  shellVersion: string;
  bundledVersion: string;
  /** What this process actually launched with. Defaults to bundledVersion. */
  runningVersion?: string;
  repo?: string;
  arch?: string;
  fetch?: typeof fetch;
  extract?: (zipPath: string, destDir: string) => Promise<void>;
}): Promise<HotCheckResult> {
  const repo = opts.repo ?? HOT_REPO;
  const fetchImpl = opts.fetch ?? fetch;
  const extract = opts.extract ?? extractZip;
  const bundled = normalizeVersion(opts.bundledVersion);
  const running = normalizeVersion(opts.runningVersion ?? opts.bundledVersion);
  const applied = readCurrentVersion(opts.hotRoot);
  // A downloaded tree only counts once it would actually launch. It is the
  // updater's floor only when it beats the bundle; otherwise a broken copy or
  // a hot tree older than the installed dmg would hide newer releases.
  const appliedLayout = applied ? hotLayoutError(versionDir(opts.hotRoot, applied)) : null;
  const appliedUsable =
    applied && compareVersions(applied, bundled) > 0 && !appliedLayout ? applied : null;
  const floor = highestVersion([running, bundled, appliedUsable ?? "0.0.0"]);

  const manifestUrl = releaseAssetUrl(repo, HOT_MANIFEST_NAME);
  const zipUrl = releaseAssetUrl(repo, HOT_ZIP_NAME);
  const headers = { "User-Agent": "muse-work" };

  let manifest: HotManifest | null;
  try {
    const response = await fetchImpl(manifestUrl, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    manifest = parseHotManifest(await readJson(response));
  } catch (err) {
    return { status: "skipped", reason: err instanceof Error ? err.message : String(err) };
  }
  if (!manifest) return { status: "skipped", reason: "invalid hot manifest" };
  if (manifest.shell !== opts.shellVersion) {
    if (compareVersions(manifest.shell, opts.shellVersion) <= 0) {
      return { status: "skipped", reason: "shell mismatch" };
    }
    return {
      status: "installer",
      version: manifest.version,
      shell: manifest.shell,
      url: releaseAssetUrl(
        repo,
        installerAssetName(manifest.version, opts.arch ?? process.arch),
      ),
    };
  }
  if (compareVersions(manifest.version, floor) <= 0) {
    // Nothing new to download, but the tree on disk is newer than the process
    // that is serving it. Say so, so the restart path stays reachable.
    if (appliedUsable && compareVersions(appliedUsable, running) > 0) {
      return { status: "restart", version: appliedUsable };
    }
    return { status: "current" };
  }

  fs.mkdirSync(opts.hotRoot, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(opts.hotRoot, "tmp-"));
  const zipPath = path.join(tmp, HOT_ZIP_NAME);
  const staging = path.join(tmp, "staging");
  try {
    const response = await fetchImpl(zipUrl, {
      headers,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) return { status: "skipped", reason: `HTTP ${response.status}` };
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(zipPath, bytes);
    const hash = await sha256File(zipPath);
    if (hash !== manifest.sha256) return { status: "skipped", reason: "checksum mismatch" };
    await extract(zipPath, staging);
    const layout = hotLayoutError(staging);
    if (layout) return { status: "skipped", reason: layout };
    const dest = versionDir(opts.hotRoot, manifest.version);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(staging, dest);
    writeCurrent(opts.hotRoot, manifest.version);
    pruneVersions(opts.hotRoot, manifest.version);
    return { status: "updated", version: manifest.version };
  } catch (err) {
    return { status: "skipped", reason: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
