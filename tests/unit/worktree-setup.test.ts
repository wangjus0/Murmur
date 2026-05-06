import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const setupScript = path.join(repoRoot, "scripts", "setup-worktree.mjs");
const cleanupScript = path.join(repoRoot, "scripts", "cleanup-worktree.mjs");

test("worktree setup records copied env before dependency install", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-worktree-"));

  try {
    execFileSync("git", ["init"], {
      cwd: tempRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });

    const sourceEnv = path.join(tempRoot, "source.env");
    fs.writeFileSync(sourceEnv, "ELEVENLABS_API_KEY=test-key\n", "utf8");

    const fakeBin = path.join(tempRoot, "bin");
    fs.mkdirSync(fakeBin);
    const fakeNpm = path.join(fakeBin, "npm");
    fs.writeFileSync(fakeNpm, "#!/bin/sh\nexit 17\n", "utf8");
    fs.chmodSync(fakeNpm, 0o755);

    const result = spawnSync(process.execPath, [setupScript], {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MURMUR_WORKTREE_ENV_SOURCE: sourceEnv,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });

    assert.notEqual(result.status, 0);
    assert.equal(
      fs.readFileSync(path.join(tempRoot, "apps", "server", ".env"), "utf8"),
      "ELEVENLABS_API_KEY=test-key\n"
    );

    const state = JSON.parse(
      fs.readFileSync(path.join(tempRoot, ".murmur-worktree-setup.json"), "utf8")
    ) as { createdFiles?: unknown };
    assert.deepEqual(state.createdFiles, [path.join("apps", "server", ".env")]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("worktree cleanup keeps env files that setup overwrote", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-worktree-"));

  try {
    execFileSync("git", ["init"], {
      cwd: tempRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });

    const sourceEnv = path.join(tempRoot, "source.env");
    fs.writeFileSync(sourceEnv, "ELEVENLABS_API_KEY=new-key\n", "utf8");

    const targetEnv = path.join(tempRoot, "apps", "server", ".env");
    fs.mkdirSync(path.dirname(targetEnv), { recursive: true });
    fs.writeFileSync(targetEnv, "ELEVENLABS_API_KEY=old-key\n", "utf8");

    const setupResult = spawnSync(process.execPath, [setupScript, "--overwrite-env"], {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MURMUR_SKIP_NPM_INSTALL: "1",
        MURMUR_WORKTREE_ENV_SOURCE: sourceEnv,
      },
    });
    assert.equal(setupResult.status, 0);
    assert.equal(fs.existsSync(path.join(tempRoot, ".murmur-worktree-setup.json")), false);

    const cleanupResult = spawnSync(process.execPath, [cleanupScript], {
      cwd: tempRoot,
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(cleanupResult.status, 0);
    assert.equal(fs.readFileSync(targetEnv, "utf8"), "ELEVENLABS_API_KEY=new-key\n");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
