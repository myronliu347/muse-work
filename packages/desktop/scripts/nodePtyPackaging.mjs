/**
 * pnpm installs node-pty as a symlink into the virtual store. electron-builder
 * copies that symlink as-is, so a packaged app launched from the repo resolves
 * pty.node back to the store copy — the one node-gyp built for the system Node
 * (Node 24 => NODE_MODULE_VERSION 137). Electron 43 needs 148.
 *
 * Replace the symlink with a real directory for the duration of packaging, then
 * put the symlink back.
 */
import fs from "node:fs";
import path from "node:path";

export function nodePtyPath(appDir) {
  return path.join(appDir, "node_modules", "node-pty");
}

function stashPath(appDir) {
  return path.join(appDir, "node_modules", ".node-pty-link");
}

export function materializeNodePty(appDir) {
  const linkPath = nodePtyPath(appDir);
  const stat = fs.lstatSync(linkPath);
  if (!stat.isSymbolicLink()) return false;

  const linkText = fs.readlinkSync(linkPath);
  const target = fs.realpathSync(linkPath);
  const stash = stashPath(appDir);
  fs.writeFileSync(stash, linkText, "utf8");
  fs.unlinkSync(linkPath);
  try {
    fs.cpSync(target, linkPath, { recursive: true, dereference: true });
  } catch (err) {
    fs.symlinkSync(linkText, linkPath);
    fs.rmSync(stash, { force: true });
    throw err;
  }
  return true;
}

export function restoreNodePty(appDir) {
  const stash = stashPath(appDir);
  if (!fs.existsSync(stash)) return false;

  const linkText = fs.readFileSync(stash, "utf8");
  const linkPath = nodePtyPath(appDir);
  if (fs.existsSync(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) fs.unlinkSync(linkPath);
    else fs.rmSync(linkPath, { recursive: true, force: true });
  }
  fs.symlinkSync(linkText, linkPath);
  fs.rmSync(stash, { force: true });
  return true;
}
