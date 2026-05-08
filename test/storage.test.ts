import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import { createDefaultMcpServerConfig } from "../src/mcp/config.js";
import { AuditLogger } from "../src/storage/auditLogger.js";
import { BankRepository } from "../src/storage/bankRepository.js";

test("repository lists starter entries from the managed storage", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const repository = new BankRepository(bankRoot);

  await repository.ensureStructure();
  await repository.ensureStarterFiles();

  const ruleEntries = await repository.listEntries("rules");
  const skillEntries = await repository.listEntries("skills");

  assert.deepEqual(
    ruleEntries.map((entry) => entry.path),
    ["general.md", "runtime.md", "strict-mode.md"],
  );
  assert.deepEqual(skillEntries.map((entry) => entry.path), ["task-based-reading/SKILL.md"]);
});

test("repository lists only canonical entry files from entry roots", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const repository = new BankRepository(bankRoot);

  await repository.ensureStructure();
  await repository.ensureStarterFiles();
  await writeFile(path.join(bankRoot, "shared", "rules", ".DS_Store"), "metadata");
  await writeFile(path.join(bankRoot, "shared", "rules", "README.md"), "# Rules\n");
  await writeFile(path.join(bankRoot, "shared", "rules", "notes.txt"), "Notes\n");
  await writeFile(path.join(bankRoot, "shared", "skills", "README.md"), "# Skills\n");
  await writeFile(path.join(bankRoot, "shared", "skills", "loose.md"), "Loose\n");

  const ruleEntries = await repository.listEntries("rules");
  const skillEntries = await repository.listEntries("skills");

  assert.deepEqual(
    ruleEntries.map((entry) => entry.path),
    ["general.md", "runtime.md", "strict-mode.md"],
  );
  assert.deepEqual(skillEntries.map((entry) => entry.path), ["task-based-reading/SKILL.md"]);
});

test("repository rejects reading entries outside the managed root", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const repository = new BankRepository(bankRoot);

  await repository.ensureStructure();
  await repository.ensureStarterFiles();

  await assert.rejects(() => repository.readEntry("rules", "../manifest.json"));
});

test("audit logger rejects writing through a symbolic link", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
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
      providerSessionId: null,
      providerSessionSource: "unresolved",
      tool: "upsert_rule",
      action: "upsert",
      scope: "shared",
      kind: "rules",
      projectId: "demo-project",
      projectPath: "/tmp/demo-project",
      path: "demo.md",
      before: {
        exists: false,
        sha256: null,
        charCount: 0,
        lineCount: 0,
        entryId: null,
        title: null,
        entryKind: null,
        stack: null,
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
        stack: null,
        topics: ["demo"],
      },
      deltaChars: 10,
      deltaLines: 1,
    }),
  );
});

test("repository tolerates legacy provider integration descriptor fields while returning the canonical shape", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-storage-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const repository = new BankRepository(bankRoot);
  const mcpServerConfig = createDefaultMcpServerConfig(bankRoot);

  await repository.ensureStructure();
  await writeFile(
    path.join(bankRoot, "integrations", "codex.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        provider: "codex",
        displayName: "Codex",
        serverName: "guidance-bank",
        installationMethod: "provider-cli",
        scope: "user",
        mcpServer: {
          ...mcpServerConfig,
          env: {
            ...mcpServerConfig.env,
            GUIDANCEBANK_PROVIDER_ID: "codex",
          },
        },
        instructions: ["legacy field"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  assert.deepEqual(await repository.readProviderIntegrationOptional("codex"), {
    schemaVersion: 1,
    provider: "codex",
    displayName: "Codex",
    serverName: "guidance-bank",
    installationMethod: "provider-cli",
    scope: "user",
    mcpServer: {
      ...mcpServerConfig,
      env: {
        ...mcpServerConfig.env,
        GUIDANCEBANK_PROVIDER_ID: "codex",
      },
    },
  });
});
