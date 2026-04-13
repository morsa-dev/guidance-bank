import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import { AuditLogger } from "../src/storage/auditLogger.js";
import { BankRepository } from "../src/storage/bankRepository.js";

test("repository lists starter entries from the managed storage", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const repository = new BankRepository(bankRoot);

  await repository.ensureStructure();
  await repository.ensureStarterFiles();

  const ruleEntries = await repository.listEntries("rules");
  const skillEntries = await repository.listEntries("skills");

  assert.deepEqual(
    ruleEntries.map((entry) => entry.path),
    [
      "core/general.md",
      "core/README.md",
      "providers/README.md",
      "stacks/nodejs/runtime.md",
      "stacks/README.md",
      "stacks/typescript/strict-mode.md",
      "topics/README.md",
    ],
  );
  assert.deepEqual(skillEntries.map((entry) => entry.path), ["README.md", "shared/task-based-reading/SKILL.md"]);
});

test("repository rejects reading entries outside the managed root", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const repository = new BankRepository(bankRoot);

  await repository.ensureStructure();
  await repository.ensureStarterFiles();

  await assert.rejects(() => repository.readEntry("rules", "../manifest.json"));
});

test("audit logger rejects writing through a symbolic link", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const repository = new BankRepository(bankRoot);
  const outsideFilePath = path.join(tempDirectoryPath, "outside.ndjson");

  await repository.ensureStructure();
  await mkdir(path.join(bankRoot, "audit"), { recursive: true });
  await writeFile(outsideFilePath, "", "utf8");
  await symlink(outsideFilePath, path.join(bankRoot, "audit", "events.ndjson"));

  const auditLogger = new AuditLogger({
    bankRoot,
    provider: null,
  });

  await assert.rejects(() =>
    auditLogger.writeEvent({
      sessionRef: null,
      tool: "upsert_rule",
      action: "upsert",
      scope: "shared",
      kind: "rules",
      projectId: "demo-project",
      projectPath: "/tmp/demo-project",
      path: "topics/demo.md",
      before: {
        exists: false,
        sha256: null,
        charCount: 0,
        lineCount: 0,
        entryId: null,
        title: null,
        entryKind: null,
        stacks: [],
        topics: [],
      },
      after: {
        exists: true,
        sha256: "abc",
        charCount: 10,
        lineCount: 1,
        entryId: "demo-rule",
        title: "Demo Rule",
        entryKind: "rule",
        stacks: [],
        topics: ["demo"],
      },
      deltaChars: 10,
      deltaLines: 1,
    }),
  );
});
