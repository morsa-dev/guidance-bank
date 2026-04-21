import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { InitService } from "../src/core/init/initService.js";
import type { CommandRunner } from "../src/core/providers/types.js";
import { BankRepository } from "../src/storage/bankRepository.js";
import { detectBankUpgrade } from "../src/core/upgrade/upgradeService.js";

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

test("init migrates a legacy .memory-bank root to .guidance-bank without marking content upgraded", async () => {
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
  assert.equal(result.manifest.storageVersion, 1);
  assert.deepEqual(result.manifest.enabledProviders, ["codex", "cursor"]);
  await assert.rejects(access(legacyBankRoot));

  const manifestContent = JSON.parse(await readFile(path.join(bankRoot, "manifest.json"), "utf8")) as {
    storageVersion: number;
    enabledProviders: string[];
  };
  assert.equal(manifestContent.storageVersion, 1);
  assert.deepEqual(manifestContent.enabledProviders, ["codex", "cursor"]);

  const upgradeDetection = await detectBankUpgrade(bankRoot);
  assert.equal(upgradeDetection.status, "upgrade_required");
});

test("init migrates a legacy .guidancebank root to .guidance-bank without marking content upgraded", async () => {
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
  assert.equal(result.manifest.storageVersion, 1);
  assert.deepEqual(result.manifest.enabledProviders, ["cursor", "claude-code"]);
  await assert.rejects(access(legacyBankRoot));

  const manifestContent = JSON.parse(await readFile(path.join(bankRoot, "manifest.json"), "utf8")) as {
    storageVersion: number;
    enabledProviders: string[];
  };
  assert.equal(manifestContent.storageVersion, 1);
  assert.deepEqual(manifestContent.enabledProviders, ["cursor", "claude-code"]);

  const upgradeDetection = await detectBankUpgrade(bankRoot);
  assert.equal(upgradeDetection.status, "upgrade_required");
});

test("init preserves existing legacy storage version so agents still route through upgrade_bank", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-init-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");

  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const repository = new BankRepository(bankRoot);

  await repository.ensureStructure();
  await repository.writeManifest({
    schemaVersion: 1,
    storageVersion: 2,
    bankId: "66666666-6666-4666-8666-666666666666",
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    enabledProviders: ["codex"],
    defaultMcpTransport: "stdio",
  });
  await mkdir(path.join(bankRoot, "shared", "rules", "topics"), { recursive: true });
  await writeFile(
    path.join(bankRoot, "shared", "rules", "topics", "mixed-stack.md"),
    `---
id: shared-mixed-stack
kind: rule
title: Mixed Stack
stacks: [nodejs, typescript]
topics: [runtime]
---

# Mixed Stack

- Keep runtime and typing guidance together until reviewed.
`,
  );

  const result = await initService.run({
    bankRoot,

    cursorConfigRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  assert.equal(result.alreadyExisted, true);
  assert.equal(result.manifest.storageVersion, 2);
  assert.deepEqual(result.manifest.enabledProviders, ["codex", "cursor"]);

  const manifestContent = JSON.parse(await readFile(path.join(bankRoot, "manifest.json"), "utf8")) as {
    storageVersion: number;
    enabledProviders: string[];
  };
  assert.equal(manifestContent.storageVersion, 2);
  assert.deepEqual(manifestContent.enabledProviders, ["codex", "cursor"]);

  const legacyEntryContent = await readFile(path.join(bankRoot, "shared", "rules", "topics", "mixed-stack.md"), "utf8");
  assert.match(legacyEntryContent, /stacks: \[nodejs, typescript\]/);

  const upgradeDetection = await detectBankUpgrade(bankRoot);
  assert.equal(upgradeDetection.status, "upgrade_required");
});
