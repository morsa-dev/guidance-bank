import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, readFile } from "node:fs/promises";
import test from "node:test";

import { InitService } from "../src/core/init/initService.js";
import type { CommandRunner } from "../src/core/providers/types.js";
import { BankRepository } from "../src/storage/bankRepository.js";

const createSuccessfulCommandRunner = (): CommandRunner => async ({ command, args }) => ({
  command,
  args,
  exitCode: command === "codex" && args[1] === "get" ? 1 : command === "claude" && args[1] === "get" ? 1 : 0,
  stdout: "",
  stderr: "",
});

test("init creates the bank structure and writes the manifest", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-init-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
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
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
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

test("init migrates a legacy .memory-bank root to .guidance-bank and upgrades the storage version", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-init-"));
  const legacyBankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const legacyRepository = new BankRepository(legacyBankRoot);

  await legacyRepository.ensureStructure();
  await legacyRepository.ensureStarterFiles();
  await legacyRepository.writeManifest({
    schemaVersion: 1,
    storageVersion: 1,
    bankId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    enabledProviders: ["codex"],
    defaultMcpTransport: "stdio",
  });

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  assert.equal(result.alreadyExisted, true);
  assert.equal(result.manifest.storageVersion, 2);
  assert.deepEqual(result.manifest.enabledProviders, ["codex", "cursor"]);
  await assert.rejects(access(legacyBankRoot));

  const manifestContent = JSON.parse(await readFile(path.join(bankRoot, "manifest.json"), "utf8")) as {
    storageVersion: number;
    enabledProviders: string[];
  };
  assert.equal(manifestContent.storageVersion, 2);
  assert.deepEqual(manifestContent.enabledProviders, ["codex", "cursor"]);
});

test("init migrates a legacy .guidancebank root to .guidance-bank and upgrades the storage version", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-init-"));
  const legacyBankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const legacyRepository = new BankRepository(legacyBankRoot);

  await legacyRepository.ensureStructure();
  await legacyRepository.ensureStarterFiles();
  await legacyRepository.writeManifest({
    schemaVersion: 1,
    storageVersion: 1,
    bankId: "55555555-5555-4555-8555-555555555555",
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    enabledProviders: ["cursor"],
    defaultMcpTransport: "stdio",
  });

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["claude-code"],
  });

  assert.equal(result.alreadyExisted, true);
  assert.equal(result.manifest.storageVersion, 2);
  assert.deepEqual(result.manifest.enabledProviders, ["cursor", "claude-code"]);
  await assert.rejects(access(legacyBankRoot));

  const manifestContent = JSON.parse(await readFile(path.join(bankRoot, "manifest.json"), "utf8")) as {
    storageVersion: number;
    enabledProviders: string[];
  };
  assert.equal(manifestContent.storageVersion, 2);
  assert.deepEqual(manifestContent.enabledProviders, ["cursor", "claude-code"]);
});
