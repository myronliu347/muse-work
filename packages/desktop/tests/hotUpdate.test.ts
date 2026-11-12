import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkForHotUpdate,
  compareVersions,
  discardActiveHot,
  HOT_MANIFEST_NAME,
  HOT_REPO,
  HOT_ZIP_NAME,
  parseHotManifest,
  pickInstallerUrl,
  readBundledHot,
  readFailedHot,
  readShellVersion,
  resolveLaunchResources,
  markHotFailed,
} from "../src/main/hotUpdate";

const roots: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-hot-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeHot(hotRoot: string, version: string): void {
  const dir = path.join(hotRoot, "versions", version);
  fs.mkdirSync(path.join(dir, "webview"), { recursive: true });
  fs.writeFileSync(path.join(dir, "webview", "index.html"), "<html></html>");
  fs.mkdirSync(path.join(dir, "muse-server", "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "muse-server", "dist", "index.js"), "export {}");
  fs.writeFileSync(
    path.join(dir, "muse-server", "package.json"),
    JSON.stringify({ name: "@muse-work/server" }),
  );
  fs.mkdirSync(hotRoot, { recursive: true });
  fs.writeFileSync(path.join(hotRoot, "current.json"), `${JSON.stringify({ version })}\n`);
}

describe("hot update", () => {
  it("orders versions and rejects a manifest that is not the hot zip", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
    expect(
      parseHotManifest({
        version: "v0.2.0",
        shell: "0.1.0",
        sha256: "a".repeat(64),
        asset: HOT_ZIP_NAME,
      }),
    ).toMatchObject({ version: "0.2.0", shell: "0.1.0" });
    expect(
      parseHotManifest({
        version: "0.2.0",
        shell: "0.1.0",
        sha256: "a".repeat(64),
        asset: "other.zip",
      }),
    ).toBeNull();
  });

  it("uses a newer hot tree and drops it when the layout is broken", () => {
    const hotRoot = tempRoot();
    const bundled = {
      webviewHtmlPath: "/bundled/index.html",
      serverEntry: "/bundled/index.js",
      version: "0.1.0",
    };
    writeHot(hotRoot, "0.2.0");
    const launch = resolveLaunchResources({ hotRoot, bundled });
    expect(launch.source).toBe("hot");
    expect(launch.webviewHtmlPath).toContain(`${path.sep}0.2.0${path.sep}webview${path.sep}index.html`);

    fs.rmSync(path.join(hotRoot, "versions", "0.2.0", "webview"), { recursive: true });
    const fallback = resolveLaunchResources({ hotRoot, bundled });
    expect(fallback.source).toBe("bundled");
    expect(fs.existsSync(path.join(hotRoot, "current.json"))).toBe(false);
  });

  it("keeps the bundled copy when the installed dmg is already newer", () => {
    const hotRoot = tempRoot();
    writeHot(hotRoot, "0.1.0");
    const launch = resolveLaunchResources({
      hotRoot,
      bundled: {
        webviewHtmlPath: "/bundled/index.html",
        serverEntry: "/bundled/index.js",
        version: "0.2.0",
      },
    });
    expect(launch.source).toBe("bundled");
    expect(launch.version).toBe("0.2.0");
  });

  it("downloads a matching shell update and skips a shell mismatch", async () => {
    const hotRoot = tempRoot();
    const zipBody = Buffer.from("hot-bytes");
    const sha256 = createHash("sha256").update(zipBody).digest("hex");
    const manifest = {
      version: "0.3.0",
      shell: "0.1.0",
      sha256,
      asset: HOT_ZIP_NAME,
    };
    const fetchImpl = (async (url: string) => {
      const href = String(url);
      if (href.endsWith(`/${HOT_MANIFEST_NAME}`)) return Response.json(manifest);
      if (href.endsWith(`/${HOT_ZIP_NAME}`)) return new Response(zipBody);
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const updated = await checkForHotUpdate({
      hotRoot,
      shellVersion: "0.1.0",
      bundledVersion: "0.1.0",
      fetch: fetchImpl,
      extract: async (_zip, dest) => {
        fs.mkdirSync(path.join(dest, "webview"), { recursive: true });
        fs.writeFileSync(path.join(dest, "webview", "index.html"), "<html></html>");
        fs.mkdirSync(path.join(dest, "muse-server", "dist"), { recursive: true });
        fs.writeFileSync(path.join(dest, "muse-server", "dist", "index.js"), "");
        fs.writeFileSync(
          path.join(dest, "muse-server", "package.json"),
          JSON.stringify({ name: "@muse-work/server" }),
        );
      },
    });
    expect(updated).toEqual({ status: "updated", version: "0.3.0" });
    const launch = resolveLaunchResources({
      hotRoot,
      bundled: {
        webviewHtmlPath: "/bundled/index.html",
        serverEntry: "/bundled/index.js",
        version: "0.1.0",
      },
    });
    expect(launch.source).toBe("hot");
    expect(launch.version).toBe("0.3.0");

    const skipped = await checkForHotUpdate({
      hotRoot: tempRoot(),
      shellVersion: "0.1.0",
      bundledVersion: "0.1.0",
      arch: "arm64",
      fetch: (async () => Response.json({ ...manifest, shell: "0.9.0" })) as typeof fetch,
    });
    expect(skipped).toEqual({
      status: "installer",
      version: "0.3.0",
      shell: "0.9.0",
      url: `https://github.com/${HOT_REPO}/releases/latest/download/Muse-0.3.0-arm64.dmg`,
    });
  });

  it("points a newer shell at the matching dmg and ignores an older shell", () => {
    expect(
      pickInstallerUrl(
        {
          html_url: "https://example.test/release",
          assets: [
            { name: "Muse-0.9.0-arm64.dmg", browser_download_url: "https://example.test/arm.dmg" },
            { name: "Muse-0.9.0.dmg", browser_download_url: "https://example.test/generic.dmg" },
          ],
        },
        "arm64",
        "https://example.test/fallback",
      ),
    ).toBe("https://example.test/arm.dmg");
    expect(
      pickInstallerUrl({ assets: [] }, "arm64", `https://github.com/${HOT_REPO}/releases/latest`),
    ).toBe(`https://github.com/${HOT_REPO}/releases/latest`);
  });

  it("does not offer an installer when the published shell is older", async () => {
    const result = await checkForHotUpdate({
      hotRoot: tempRoot(),
      shellVersion: "0.2.0",
      bundledVersion: "0.2.0",
      fetch: (async () =>
        Response.json({
          version: "0.1.5",
          shell: "0.1.0",
          sha256: "a".repeat(64),
          asset: HOT_ZIP_NAME,
        })) as typeof fetch,
    });
    expect(result).toEqual({ status: "skipped", reason: "shell mismatch" });
  });

  it("refuses a zip whose checksum does not match the manifest", async () => {
    const hotRoot = tempRoot();
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(`/${HOT_MANIFEST_NAME}`)) {
        return Response.json({
          version: "0.3.0",
          shell: "0.1.0",
          sha256: "ab".repeat(32),
          asset: HOT_ZIP_NAME,
        });
      }
      return new Response(Buffer.from("not-the-bytes"));
    }) as typeof fetch;

    const result = await checkForHotUpdate({
      hotRoot,
      shellVersion: "0.1.0",
      bundledVersion: "0.1.0",
      fetch: fetchImpl,
      extract: async () => {
        throw new Error("should not extract");
      },
    });
    expect(result).toEqual({ status: "skipped", reason: "checksum mismatch" });
    expect(fs.existsSync(path.join(hotRoot, "current.json"))).toBe(false);
  });

  it("reads the baked shell separately from the release version", () => {
    const dir = tempRoot();
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ version: "0.4.0", shellVersion: "0.2.0" }),
    );
    fs.writeFileSync(
      path.join(dir, "bundled-hot.json"),
      JSON.stringify({ version: "0.4.0", shell: "0.2.0" }),
    );
    expect(readShellVersion(path.join(dir, "package.json"))).toBe("0.2.0");
    expect(readBundledHot(dir)).toEqual({ version: "0.4.0", shell: "0.2.0" });
  });

  it("does not re-download a version that already failed to boot", async () => {
    const hotRoot = tempRoot();
    markHotFailed(hotRoot, "0.2.0");
    expect(readFailedHot(hotRoot)).toBe("0.2.0");
    let downloads = 0;
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(`/${HOT_MANIFEST_NAME}`)) {
        return Response.json({
          version: "0.2.0",
          shell: "0.1.0",
          sha256: "a".repeat(64),
          asset: HOT_ZIP_NAME,
        });
      }
      downloads += 1;
      return new Response("nope");
    }) as typeof fetch;

    const result = await checkForHotUpdate({
      hotRoot,
      shellVersion: "0.1.0",
      bundledVersion: "0.1.0",
      runningVersion: "0.1.0",
      fetch: fetchImpl,
    });
    expect(result).toEqual({ status: "current" });
    expect(downloads).toBe(0);
  });

  it("clears the failure marker once a newer version installs", async () => {
    const hotRoot = tempRoot();
    markHotFailed(hotRoot, "0.2.0");
    const zipBody = Buffer.from("hot-bytes");
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(`/${HOT_MANIFEST_NAME}`)) {
        return Response.json({
          version: "0.3.0",
          shell: "0.1.0",
          sha256: createHash("sha256").update(zipBody).digest("hex"),
          asset: HOT_ZIP_NAME,
        });
      }
      return new Response(zipBody);
    }) as typeof fetch;

    const result = await checkForHotUpdate({
      hotRoot,
      shellVersion: "0.1.0",
      bundledVersion: "0.1.0",
      runningVersion: "0.1.0",
      fetch: fetchImpl,
      extract: async (_zip, dest) => {
        fs.mkdirSync(path.join(dest, "webview"), { recursive: true });
        fs.writeFileSync(path.join(dest, "webview", "index.html"), "<html></html>");
        fs.mkdirSync(path.join(dest, "muse-server", "dist"), { recursive: true });
        fs.writeFileSync(path.join(dest, "muse-server", "dist", "index.js"), "");
        fs.writeFileSync(
          path.join(dest, "muse-server", "package.json"),
          JSON.stringify({ name: "@muse-work/server" }),
        );
      },
    });
    expect(result).toEqual({ status: "updated", version: "0.3.0" });
    expect(readFailedHot(hotRoot)).toBeNull();
  });

  it("keeps offering a restart while the downloaded tree is newer than the running one", async () => {
    const hotRoot = tempRoot();
    writeHot(hotRoot, "0.2.0");
    const fetchImpl = (async () =>
      Response.json({
        version: "0.2.0",
        shell: "0.1.0",
        sha256: "a".repeat(64),
        asset: HOT_ZIP_NAME,
      })) as typeof fetch;

    const pending = await checkForHotUpdate({
      hotRoot,
      shellVersion: "0.1.0",
      bundledVersion: "0.1.0",
      runningVersion: "0.1.0",
      fetch: fetchImpl,
      extract: async () => {
        throw new Error("should not download twice");
      },
    });
    expect(pending).toEqual({ status: "restart", version: "0.2.0" });

    const afterRestart = await checkForHotUpdate({
      hotRoot,
      shellVersion: "0.1.0",
      bundledVersion: "0.1.0",
      runningVersion: "0.2.0",
      fetch: fetchImpl,
    });
    expect(afterRestart).toEqual({ status: "current" });
  });

  it("re-downloads over a broken applied tree instead of calling it current", async () => {
    const hotRoot = tempRoot();
    writeHot(hotRoot, "0.2.0");
    fs.rmSync(path.join(hotRoot, "versions", "0.2.0", "webview"), { recursive: true });
    const zipBody = Buffer.from("hot-bytes");
    const fetchImpl = (async (url: string) => {
      const href = String(url);
      if (href.endsWith(`/${HOT_MANIFEST_NAME}`)) {
        return Response.json({
          version: "0.2.0",
          shell: "0.1.0",
          sha256: createHash("sha256").update(zipBody).digest("hex"),
          asset: HOT_ZIP_NAME,
        });
      }
      return new Response(zipBody);
    }) as typeof fetch;

    const result = await checkForHotUpdate({
      hotRoot,
      shellVersion: "0.1.0",
      bundledVersion: "0.1.0",
      runningVersion: "0.1.0",
      fetch: fetchImpl,
      extract: async (_zip, dest) => {
        fs.mkdirSync(path.join(dest, "webview"), { recursive: true });
        fs.writeFileSync(path.join(dest, "webview", "index.html"), "<html></html>");
        fs.mkdirSync(path.join(dest, "muse-server", "dist"), { recursive: true });
        fs.writeFileSync(path.join(dest, "muse-server", "dist", "index.js"), "");
        fs.writeFileSync(
          path.join(dest, "muse-server", "package.json"),
          JSON.stringify({ name: "@muse-work/server" }),
        );
      },
    });
    expect(result).toEqual({ status: "updated", version: "0.2.0" });
  });

  it("discards the active hot directory", () => {
    const hotRoot = tempRoot();
    writeHot(hotRoot, "0.4.0");
    discardActiveHot(hotRoot);
    expect(fs.existsSync(path.join(hotRoot, "versions", "0.4.0"))).toBe(false);
    expect(fs.existsSync(path.join(hotRoot, "current.json"))).toBe(false);
  });
});
