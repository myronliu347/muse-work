/**
 * pnpm deploy writes absolute symlinks into node_modules. Node's
 * fs.cpSync({ dereference: true }) copies those directory links unchanged, so
 * a packaged app keeps pointing at the build machine. Rewrite in-tree links
 * to relative ones, and replace anything that points outside with a real copy.
 */
import fs from "node:fs";
import path from "node:path";

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function walkLinks(dir, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) found.push(child);
    else if (entry.isDirectory()) walkLinks(child, found);
  }
}

function copyReal(src, dest, seen) {
  const real = fs.realpathSync(src);
  if (seen.has(real)) {
    throw new Error(`symlink cycle while copying ${src}`);
  }
  const stat = fs.statSync(real);
  if (stat.isDirectory()) {
    seen.add(real);
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(real)) {
      copyReal(path.join(real, name), path.join(dest, name), seen);
    }
    seen.delete(real);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(real, dest);
  if (stat.mode & 0o111) fs.chmodSync(dest, stat.mode);
}

/**
 * Copy [src] to [dest], keeping symlink text unchanged.
 * Node's fs.cpSync rewrites a relative link into an absolute one.
 */
export function copyTree(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(src), dest);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyTree(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  if (stat.mode & 0o111) fs.chmodSync(dest, stat.mode);
}

/**
 * Make every symlink under [root] resolve inside [root].
 * Absolute in-tree links become relative. Links that leave [root] are copied.
 */
export function makeTreePortable(root) {
  const absRoot = path.resolve(root);
  const links = [];
  walkLinks(absRoot, links);
  for (const link of links) {
    if (!fs.lstatSync(link).isSymbolicLink()) continue;
    const raw = fs.readlinkSync(link);
    const resolved = path.resolve(path.dirname(link), raw);
    if (!fs.existsSync(resolved)) {
      throw new Error(`dangling symlink ${link} -> ${raw}`);
    }
    if (!isInside(absRoot, resolved)) {
      const tmp = `${link}.portable-tmp`;
      fs.rmSync(tmp, { recursive: true, force: true });
      copyReal(resolved, tmp, new Set());
      fs.unlinkSync(link);
      fs.renameSync(tmp, link);
      continue;
    }
    const rel = path.relative(path.dirname(link), resolved);
    if (raw === rel) continue;
    fs.unlinkSync(link);
    fs.symlinkSync(rel, link);
  }

  const left = [];
  walkLinks(absRoot, left);
  for (const link of left) {
    const raw = fs.readlinkSync(link);
    if (path.isAbsolute(raw)) {
      throw new Error(`absolute symlink remains: ${link} -> ${raw}`);
    }
    const resolved = path.resolve(path.dirname(link), raw);
    if (!isInside(absRoot, resolved)) {
      throw new Error(`symlink escapes tree: ${link} -> ${raw}`);
    }
  }
}
