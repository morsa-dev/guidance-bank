import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { refreshDefaultMcpLauncherIfInitialized } from "../src/cli/postinstall.js";
import { createMcpLauncherContent, resolveMcpLauncherPath } from "../src/mcp/launcher.js";

test("postinstall skips launcher refresh when the default bank is not initialized", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-postinstall-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");

  const result = await refreshDefaultMcpLauncherIfInitialized({ bankRoot });

  assert.equal(result, "skipped");
});

test("postinstall refreshes the launcher when the default bank is already initialized", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-postinstall-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const launcherPath = resolveMcpLauncherPath(bankRoot);

  await mkdir(bankRoot, { recursive: true });
  await writeFile(path.join(bankRoot, "manifest.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");
  await mkdir(path.dirname(launcherPath), { recursive: true });
  await writeFile(launcherPath, "stale launcher", "utf8");

  const result = await refreshDefaultMcpLauncherIfInitialized({ bankRoot });
  const launcherContents = await readFile(launcherPath, "utf8");

  assert.equal(result, "updated");
  assert.equal(launcherContents, createMcpLauncherContent());
});
