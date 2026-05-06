import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");
const setupScript = path.join(repoRoot, "scripts", "setup-worktree.mjs");
const cleanupScript = path.join(repoRoot, "scripts", "cleanup-worktree.mjs");

function createTempGitRepo(t: test.TestContext): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-worktree-test-"));
  const repoPath = path.join(tempRoot, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repoPath });
  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  return repoPath;
}

test("setup records copied env before a failed npm install", (t) => {
  const repoPath = createTempGitRepo(t);
  const sourceEnv = path.join(path.dirname(repoPath), "source.env");
  const fakeBin = path.join(path.dirname(repoPath), "bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(sourceEnv, "BROWSER_USE_API_KEY=test-key\n", "utf8");
  fs.writeFileSync(path.join(fakeBin, "npm"), "#!/bin/sh\nexit 19\n", "utf8");
  fs.chmodSync(path.join(fakeBin, "npm"), 0o755);

  const result = spawnSync(process.execPath, [setupScript], {
    cwd: repoPath,
    encoding: "utf8",
    env: {
      ...process.env,
      MURMUR_WORKTREE_ENV_SOURCE: sourceEnv,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });

  assert.notEqual(result.status, 0);
  assert.equal(
    fs.readFileSync(path.join(repoPath, "apps", "server", ".env"), "utf8"),
    "BROWSER_USE_API_KEY=test-key\n"
  );
  const state = JSON.parse(
    fs.readFileSync(path.join(repoPath, ".murmur-worktree-setup.json"), "utf8")
  ) as { createdFiles?: unknown };
  assert.deepEqual(state.createdFiles, [path.join("apps", "server", ".env")]);
});

test("cleanup refuses state entries that resolve to the repo root", (t) => {
  const repoPath = createTempGitRepo(t);
  const markerPath = path.join(repoPath, "marker.txt");
  fs.writeFileSync(markerPath, "keep\n", "utf8");
  fs.writeFileSync(
    path.join(repoPath, ".murmur-worktree-setup.json"),
    `${JSON.stringify({ createdFiles: ["."] })}\n`,
    "utf8"
  );

  const result = spawnSync(process.execPath, [cleanupScript], {
    cwd: repoPath,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Refusing to remove repo root/);
  assert.equal(fs.readFileSync(markerPath, "utf8"), "keep\n");
});
