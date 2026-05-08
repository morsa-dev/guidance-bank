import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { refreshDefaultMcpLauncherIfInitialized } from "../src/cli/postinstall.js";
import {
  createClaudeCodeSessionHookLauncherContent,
  createMcpLauncherContent,
  resolveClaudeCodeSessionHookLauncherPath,
  resolveMcpLauncherPath,
} from "../src/mcp/launcher.js";

test("postinstall skips launcher refresh when the default bank is not initialized", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-postinstall-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");

  const result = await refreshDefaultMcpLauncherIfInitialized({ bankRoot });

  assert.equal(result, "skipped");
});

test("postinstall refreshes the launcher when the default bank is already initialized", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-postinstall-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const launcherPath = resolveMcpLauncherPath(bankRoot);
  const claudeHookLauncherPath = resolveClaudeCodeSessionHookLauncherPath(bankRoot);

  await mkdir(bankRoot, { recursive: true });
  await writeFile(
    path.join(bankRoot, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      storageVersion: 3,
      bankId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
      enabledProviders: ["claude-code"],
      defaultMcpTransport: "stdio",
    }),
    "utf8",
  );
  await mkdir(path.dirname(launcherPath), { recursive: true });
  await writeFile(launcherPath, "stale launcher", "utf8");
  await writeFile(claudeHookLauncherPath, "stale hook launcher", "utf8");

  const result = await refreshDefaultMcpLauncherIfInitialized({ bankRoot });
  const launcherContents = await readFile(launcherPath, "utf8");
  const claudeHookLauncherContents = await readFile(claudeHookLauncherPath, "utf8");

  assert.equal(result, "updated");
  assert.equal(launcherContents, createMcpLauncherContent());
  assert.equal(claudeHookLauncherContents, createClaudeCodeSessionHookLauncherContent(bankRoot));
});

test("postinstall removes the Claude hook launcher when claude-code is not enabled", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-postinstall-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const launcherPath = resolveMcpLauncherPath(bankRoot);
  const claudeHookLauncherPath = resolveClaudeCodeSessionHookLauncherPath(bankRoot);

  await mkdir(bankRoot, { recursive: true });
  await writeFile(
    path.join(bankRoot, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      storageVersion: 3,
      bankId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-05-08T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
      enabledProviders: ["cursor"],
      defaultMcpTransport: "stdio",
    }),
    "utf8",
  );
  await mkdir(path.dirname(launcherPath), { recursive: true });
  await writeFile(launcherPath, "stale launcher", "utf8");
  await writeFile(claudeHookLauncherPath, "stale hook launcher", "utf8");

  const result = await refreshDefaultMcpLauncherIfInitialized({ bankRoot });
  const launcherContents = await readFile(launcherPath, "utf8");

  assert.equal(result, "updated");
  assert.equal(launcherContents, createMcpLauncherContent());
  await assert.rejects(readFile(claudeHookLauncherPath, "utf8"), { code: "ENOENT" });
});
