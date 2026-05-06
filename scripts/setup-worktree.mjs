#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = resolveRepoRoot();
const serverEnvRel = path.join("apps", "server", ".env");
const stateRel = ".murmur-worktree-setup.json";
const args = new Set(process.argv.slice(2));

const state = {
  version: 1,
  createdAt: new Date().toISOString(),
  createdFiles: [],
};

function log(message) {
  console.log(`[worktree:setup] ${message}`);
}

function warn(message) {
  console.warn(`[worktree:setup] ${message}`);
}

function resolveRepoRoot() {
  const cwdRoot = git(["rev-parse", "--show-toplevel"], process.cwd());
  if (cwdRoot) {
    return cwdRoot;
  }

  const scriptRoot = git(["rev-parse", "--show-toplevel"], scriptDir);
  return scriptRoot || path.resolve(process.cwd());
}

function git(gitArgs, cwd = repoRoot) {
  try {
    return execFileSync("git", gitArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeRelative(filePath) {
  const relativePath = path.relative(repoRoot, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to write outside repo root: ${filePath}`);
  }
  return relativePath;
}

function parseWorktrees() {
  const output = git(["worktree", "list", "--porcelain"], repoRoot);
  if (!output) {
    return [];
  }

  const worktrees = [];
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) {
        worktrees.push(current);
      }
      current = { path: line.slice("worktree ".length), branch: "" };
      continue;
    }

    if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    }
  }

  if (current) {
    worktrees.push(current);
  }

  return worktrees;
}

function resolveEnvSource() {
  const override = process.env.MURMUR_WORKTREE_ENV_SOURCE?.trim();
  if (override) {
    const resolved = path.resolve(repoRoot, override);
    const candidates = [
      resolved,
      path.join(resolved, serverEnvRel),
    ];

    for (const candidate of candidates) {
      if (fileExists(candidate)) {
        return candidate;
      }
    }

    warn(`MURMUR_WORKTREE_ENV_SOURCE did not point to a readable env file: ${override}`);
  }

  const targetEnv = path.join(repoRoot, serverEnvRel);
  if (fileExists(targetEnv)) {
    return targetEnv;
  }

  const currentRoot = path.resolve(repoRoot);
  const candidates = parseWorktrees()
    .filter((worktree) => path.resolve(worktree.path) !== currentRoot)
    .map((worktree) => ({
      ...worktree,
      envPath: path.join(worktree.path, serverEnvRel),
    }))
    .filter((worktree) => fileExists(worktree.envPath));

  if (candidates.length === 0) {
    return null;
  }

  const preferred = candidates.find((worktree) => worktree.branch === "refs/heads/main");
  return (preferred ?? candidates[0]).envPath;
}

function copyServerEnv() {
  const targetEnv = path.join(repoRoot, serverEnvRel);
  const sourceEnv = resolveEnvSource();

  if (!sourceEnv) {
    warn(`No source env file found. Create ${serverEnvRel} or set MURMUR_WORKTREE_ENV_SOURCE.`);
    return;
  }

  if (path.resolve(sourceEnv) === path.resolve(targetEnv)) {
    log(`${serverEnvRel} already exists.`);
    return;
  }

  const targetExisted = fileExists(targetEnv);
  if (targetExisted && !args.has("--overwrite-env")) {
    log(`${serverEnvRel} already exists; leaving it unchanged.`);
    return;
  }

  fs.mkdirSync(path.dirname(targetEnv), { recursive: true });
  fs.copyFileSync(sourceEnv, targetEnv);
  try {
    fs.chmodSync(targetEnv, 0o600);
  } catch {
    // Best-effort permissions hardening for local secret files.
  }

  if (!targetExisted) {
    state.createdFiles.push(safeRelative(targetEnv));
  }
  log(`Copied ${serverEnvRel} from another worktree.`);
}

function clearRuntimeFiles() {
  const devUrlFile = path.join(repoRoot, ".murmur-vite-dev-url");
  if (fileExists(devUrlFile)) {
    fs.rmSync(devUrlFile, { force: true });
    log("Removed stale .murmur-vite-dev-url.");
  }
}

function installDependencies() {
  if (args.has("--skip-install") || process.env.MURMUR_SKIP_NPM_INSTALL === "1") {
    log("Skipping npm install.");
    return;
  }

  log("Installing npm dependencies.");
  const result = spawnSync("npm", ["install"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`npm install failed with exit code ${result.status ?? "unknown"}`);
  }
}

function writeState() {
  if (state.createdFiles.length === 0) {
    return;
  }

  fs.writeFileSync(
    path.join(repoRoot, stateRel),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

copyServerEnv();
clearRuntimeFiles();
writeState();
installDependencies();
writeState();
log("Worktree setup complete.");
