import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { BankRepository } from "../src/storage/bankRepository.js";

test("repository lists starter entries from the managed storage", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const repository = new BankRepository(bankRoot);

  await repository.ensureStructure();
  await repository.ensureStarterFiles();

  const ruleEntries = await repository.listEntries("rules");
  const skillEntries = await repository.listEntries("skills");

  assert.deepEqual(
    ruleEntries.map((entry) => entry.path),
    ["core/README.md", "providers/README.md", "stacks/README.md"],
  );
  assert.deepEqual(skillEntries.map((entry) => entry.path), ["README.md"]);
});

test("repository rejects reading entries outside the managed root", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const repository = new BankRepository(bankRoot);

  await repository.ensureStructure();
  await repository.ensureStarterFiles();

  await assert.rejects(() => repository.readEntry("rules", "../manifest.json"));
});
