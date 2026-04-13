import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import test from "node:test";

import { InitService } from "../src/core/init/initService.js";
import type { CommandRunner } from "../src/core/providers/types.js";

const createSuccessfulCommandRunner = (): CommandRunner => async ({ command, args }) => ({
  command,
  args,
  exitCode: command === "codex" && args[1] === "get" ? 1 : command === "claude" && args[1] === "get" ? 1 : 0,
  stdout: "",
  stderr: "",
});

test("init creates the bank structure and writes the manifest", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-init-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["codex", "cursor"],
  });

  assert.equal(result.alreadyExisted, false);
  assert.deepEqual(result.manifest.enabledProviders, ["codex", "cursor"]);

  const manifestContent = JSON.parse(await readFile(path.join(bankRoot, "manifest.json"), "utf8")) as {
    enabledProviders: string[];
  };
  assert.deepEqual(manifestContent.enabledProviders, ["codex", "cursor"]);
});

test("init is idempotent and merges selected providers into the existing manifest", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-init-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["codex"],
  });

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  assert.equal(result.alreadyExisted, true);
  assert.deepEqual(result.manifest.enabledProviders, ["codex", "cursor"]);
});
