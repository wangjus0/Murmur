#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = resolveRepoRoot();
const stateRel = ".murmur-worktree-setup.json";
const args = new Set(process.argv.slice(2));

function log(message) {
  console.log(`[worktree:cleanup] ${message}`);
}

function warn(message) {
  console.warn(`[worktree:cleanup] ${message}`);
}

function resolveRepoRoot() {
  for (const cwd of [process.cwd(), scriptDir]) {
    try {
      return execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // Try the next location.
    }
  }

  return path.resolve(process.cwd());
}

function safePath(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const repoRootWithSep = `${resolvedRepoRoot}${path.sep}`;
  if (absolutePath === resolvedRepoRoot || !absolutePath.startsWith(repoRootWithSep)) {
    throw new Error(`Refusing to remove repo root or outside path: ${relativePath}`);
  }
  return absolutePath;
}

function readState() {
  const statePath = safePath(stateRel);
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function removePath(relativePath) {
  const target = safePath(relativePath);
  if (!fs.existsSync(target)) {
    return;
  }

  fs.rmSync(target, { recursive: true, force: true });
  log(`Removed ${relativePath}.`);
}

const state = readState();
const recordedFiles = Array.isArray(state?.createdFiles) ? state.createdFiles : [];

for (const relativePath of recordedFiles) {
  if (typeof relativePath === "string") {
    removePath(relativePath);
  }
}

removePath(".murmur-vite-dev-url");

if (args.has("--all")) {
  for (const relativePath of [
    "node_modules",
    "dist",
    "dist-electron",
    "release",
    path.join("apps", "client", "dist"),
    path.join("apps", "server", "dist"),
  ]) {
    removePath(relativePath);
  }
}

if (!state && !args.has("--all")) {
  warn("No setup state found; only runtime files were considered.");
}

removePath(stateRel);
log("Worktree cleanup complete.");
