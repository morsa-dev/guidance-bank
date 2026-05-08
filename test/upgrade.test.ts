import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { UpgradeService } from "../src/core/upgrade/upgradeService.js";
import type { CommandRunner } from "../src/core/providers/types.js";
import { BankRepository } from "../src/storage/bankRepository.js";
import { createConnectedClient, TextPayloadSchema, callToolStructured, writeProjectFiles } from "./helpers/mcpTestUtils.js";
import { resolveProjectIdentity } from "../src/core/projects/identity.js";

const createLegacyBankFixture = async (
  enabledProviders: Array<"codex" | "cursor" | "claude-code"> = ["cursor"],
) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-upgrade-"));
  const legacyBankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const claudeConfigRoot = path.join(tempDirectoryPath, ".claude");
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const repository = new BankRepository(legacyBankRoot);

  await repository.ensureStructure();
  await repository.ensureStarterFiles();
  await repository.writeManifest({
    schemaVersion: 1,
    storageVersion: 1,
    bankId: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    enabledProviders,
    defaultMcpTransport: "stdio",
  });
  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify(
      {
        name: "demo-project",
        dependencies: { react: "^19.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    ),
    "tsconfig.json": "{}\n",
  });

  return {
    bankRoot,
    cursorConfigRoot,
    claudeConfigRoot,
    legacyBankRoot,
    projectRoot,
    tempDirectoryPath,
  };
};

const createRecordingUpgradeCommandRunner = () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  const commandRunner: CommandRunner = async ({ command, args }) => {
    calls.push({ command, args });

    if ((command === "codex" || command === "claude") && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 1,
        stdout: "",
        stderr: `No MCP server found with name: ${args[2] ?? ""}`,
      };
    }

    return {
      command,
      args,
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  return {
    calls,
    commandRunner,
  };
};

test("resolve_context requires a bank upgrade before any missing project-bank prompt when a legacy v1 bank exists", async (t) => {
  const { bankRoot, legacyBankRoot, projectRoot } = await createLegacyBankFixture();
  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const resolved = await callToolStructured(
    client,
    "resolve_context",
    { projectPath: projectRoot },
    TextPayloadSchema,
  );

  assert.equal(resolved.requiredAction, "upgrade_bank");
  assert.equal(resolved.creationState, undefined);
  assert.equal(resolved.recommendedAction, undefined);
  assert.equal(resolved.bankRoot, bankRoot);
  assert.equal(resolved.sourceRoot, legacyBankRoot);
  assert.equal(resolved.storageVersion, 1);
  assert.equal(resolved.expectedStorageVersion, 3);
  assert.match(resolved.text, /AI Guidance Bank update is required before resolving repository context/i);
  assert.match(resolved.text, /Do not start project-bank creation, sync, or normal repository-context work until the bank-level update is complete/i);
});

test("upgrade service migrates a legacy v1 bank, removes legacy MCP registrations, reapplies current integrations, and unblocks normal resolve_context", async (t) => {
  const { bankRoot, cursorConfigRoot, claudeConfigRoot, legacyBankRoot, projectRoot } = await createLegacyBankFixture([
    "codex",
    "cursor",
    "claude-code",
  ]);
  const { calls, commandRunner } = createRecordingUpgradeCommandRunner();

  await mkdir(cursorConfigRoot, { recursive: true });
  await writeFile(
    path.join(cursorConfigRoot, "mcp.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          guidancebank: {
            command: "/legacy/guidancebank-mcp",
            args: [],
            env: {
              GUIDANCEBANK_ROOT: legacyBankRoot,
              GUIDANCEBANK_PROVIDER_ID: "cursor",
            },
          },
          "memory-bank-local": {
            command: "/legacy/memory-bank-local-mcp",
            args: [],
            env: {
              GUIDANCEBANK_ROOT: legacyBankRoot,
              GUIDANCEBANK_PROVIDER_ID: "cursor",
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(path.join(legacyBankRoot, "shared", "rules", "topics"), { recursive: true });
  await writeFile(path.join(legacyBankRoot, "shared", "rules", ".DS_Store"), "metadata");
  await writeFile(path.join(legacyBankRoot, "shared", "rules", "topics", "README.md"), "# Topic Rules\n");
  await writeFile(path.join(legacyBankRoot, "shared", "skills", "README.md"), "# Skills\n");

  const result = await new UpgradeService().run({
    bankRoot,
    cursorConfigRoot,
    claudeConfigRoot,
    commandRunner,
  });

  assert.equal(result.status, "upgraded");
  assert.equal(result.bankRoot, bankRoot);
  assert.equal(result.sourceRoot, legacyBankRoot);
  assert.equal(result.migratedBankRoot, true);
  assert.equal(result.previousStorageVersion, 1);
  assert.equal(result.storageVersion, 3);
  assert.deepEqual(result.enabledProviders, ["codex", "cursor", "claude-code"]);
  await assert.rejects(access(legacyBankRoot));

  const upgradedRepository = new BankRepository(bankRoot);
  const upgradedManifest = await upgradedRepository.readManifest();
  assert.equal(upgradedManifest.storageVersion, 3);
  assert.deepEqual(upgradedManifest.enabledProviders, ["codex", "cursor", "claude-code"]);
  await assert.rejects(access(path.join(bankRoot, "shared", "rules", ".DS_Store")));
  await assert.rejects(access(path.join(bankRoot, "shared", "rules", "topics", "README.md")));
  await assert.rejects(access(path.join(bankRoot, "shared", "skills", "README.md")));

  const cursorConfig = JSON.parse(await readFile(path.join(cursorConfigRoot, "mcp.json"), "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  };
  assert.deepEqual(Object.keys(cursorConfig.mcpServers).sort(), ["guidance-bank"]);
  const guidanceBankCursorServer = cursorConfig.mcpServers["guidance-bank"];
  assert.ok(guidanceBankCursorServer);
  assert.equal(guidanceBankCursorServer.env.GUIDANCEBANK_ROOT, bankRoot);
  assert.equal(guidanceBankCursorServer.env.GUIDANCEBANK_PROVIDER_ID, "cursor");

  const commandLines = calls.map((call) => `${call.command} ${call.args.join(" ")}`);
  assert.deepEqual(commandLines.slice(0, 3), [
    "codex mcp remove guidancebank",
    "codex mcp remove memory-bank-local",
    "codex mcp get guidance-bank --json",
  ]);
  assert.match(commandLines[3] ?? "", /^codex mcp add guidance-bank --env GUIDANCEBANK_ROOT=.* --env GUIDANCEBANK_PROVIDER_ID=codex -- /u);
  assert.deepEqual(commandLines.slice(4, 7), [
    "claude mcp remove --scope user guidancebank",
    "claude mcp remove --scope user memory-bank-local",
    "claude mcp get guidance-bank",
  ]);
  assert.match(commandLines[7] ?? "", /^claude mcp add --scope user --env=GUIDANCEBANK_ROOT=.* --env=GUIDANCEBANK_PROVIDER_ID=claude-code guidance-bank -- /u);

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const resolved = await callToolStructured(
    client,
    "resolve_context",
    { projectPath: projectRoot },
    TextPayloadSchema,
  );

  assert.equal(resolved.requiredAction, undefined);
  assert.equal(resolved.creationState, "unknown");
  assert.equal(resolved.recommendedAction, "create_bank");
  assert.equal(resolved.sourceRoot, undefined);
  assert.match(resolved.text, /No project AI Guidance Bank exists for this repository yet/i);
  assert.doesNotMatch(resolved.text, /update is required before resolving repository context/i);
});

test("upgrade service returns all ambiguous legacy stack entries for agent resolution before mutating content", async () => {
  const { bankRoot, legacyBankRoot, projectRoot } = await createLegacyBankFixture([]);
  const projectId = resolveProjectIdentity(projectRoot).projectId;
  const projectBankRoot = path.join(legacyBankRoot, "projects", projectId);

  await mkdir(path.join(projectBankRoot, "rules", "topics"), { recursive: true });
  await writeFile(
    path.join(projectBankRoot, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        projectId,
        projectName: "demo-project",
        projectPath: projectRoot,
        detectedStacks: ["angular", "nodejs"],
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-09T10:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(projectBankRoot, "rules", "topics", "app-architecture.md"),
    `---
id: project-app-architecture
kind: rule
title: App Architecture
stacks: [angular, nodejs]
topics: [architecture]
---

# App Architecture

- Keep browser and server boundaries explicit.
`,
  );

  const result = await new UpgradeService().run({ bankRoot });

  assert.equal(result.status, "needs_resolution");
  assert.equal(result.bankRoot, bankRoot);
  assert.equal(result.sourceRoot, legacyBankRoot);
  assert.equal(result.migratedBankRoot, true);
  assert.equal(result.previousStorageVersion, 1);
  assert.equal(result.storageVersion, 1);
  assert.equal(result.requiresResolution.length, 1);
  assert.equal(result.requiresResolution[0]?.reason, "multi_stack_frontmatter");
  assert.equal(result.requiresResolution[0]?.path, "app-architecture.md");
  assert.deepEqual(result.requiresResolution[0]?.legacyFrontmatter, ["stacks: [angular, nodejs]"]);
  assert.match(result.requiresResolution[0]?.requiredCurrentFrontmatter.join("\n") ?? "", /stack: <canonical-id>/);
  assert.match(result.requiresResolution[0]?.requiredCurrentFrontmatter.join("\n") ?? "", /alwaysOn: true/i);
  assert.match(result.requiresResolution[0]?.agentNextStep ?? "", /call upgrade_bank again/i);
  assert.match(result.resolutionInstructions.join("\n"), /Never keep `stacks`/i);
  assert.match(result.resolutionInstructions.join("\n"), /call `upgrade_bank` again/i);

  const manifestContent = JSON.parse(await readFile(path.join(bankRoot, "manifest.json"), "utf8")) as {
    storageVersion: number;
  };
  assert.equal(manifestContent.storageVersion, 1);

  const unresolvedEntry = await readFile(
    path.join(bankRoot, "projects", projectId, "rules", "app-architecture.md"),
    "utf8",
  );
  assert.match(unresolvedEntry, /stacks: \[angular, nodejs\]/);
});

test("upgrade service asks the agent to resolve visible non-entry files before mutating content", async () => {
  const { bankRoot, legacyBankRoot } = await createLegacyBankFixture([]);

  await writeFile(path.join(legacyBankRoot, "shared", "rules", "notes.txt"), "Internal notes\n");

  const result = await new UpgradeService().run({ bankRoot });

  assert.equal(result.status, "needs_resolution");
  assert.equal(result.requiresResolution.length, 1);
  assert.equal(result.requiresResolution[0]?.reason, "unsupported_entry_file");
  assert.equal(result.requiresResolution[0]?.path, "notes.txt");
  assert.deepEqual(result.requiresResolution[0]?.allowedResolutions, [
    "convert_to_rule_entry",
    "move_outside_bank",
    "remove_file",
  ]);
  assert.match(result.requiresResolution[0]?.agentNextStep ?? "", /call upgrade_bank again/i);

  const manifestContent = JSON.parse(await readFile(path.join(bankRoot, "manifest.json"), "utf8")) as {
    storageVersion: number;
  };
  assert.equal(manifestContent.storageVersion, 1);
  assert.equal(await readFile(path.join(bankRoot, "shared", "rules", "notes.txt"), "utf8"), "Internal notes\n");
});

test("upgrade service migrates project directories even when the project manifest is missing", async () => {
  const { bankRoot, cursorConfigRoot, legacyBankRoot } = await createLegacyBankFixture();
  const orphanProjectId = "orphan-project-without-manifest";

  await mkdir(path.join(legacyBankRoot, "projects", orphanProjectId, "rules", "core"), { recursive: true });
  await writeFile(
    path.join(legacyBankRoot, "projects", orphanProjectId, "rules", "core", "general.md"),
    `---
id: orphan-general
kind: rule
title: Orphan General
stacks: []
topics: [general]
---

# Orphan General

- Keep orphan project guidance migratable even when its manifest is missing.
`,
  );

  const result = await new UpgradeService().run({ bankRoot, cursorConfigRoot });

  assert.equal(result.status, "upgraded");

  const migratedEntry = await readFile(
    path.join(bankRoot, "projects", orphanProjectId, "rules", "general.md"),
    "utf8",
  );
  assert.match(migratedEntry, /alwaysOn: true/);
  await assert.rejects(access(path.join(bankRoot, "projects", orphanProjectId, "rules", "core", "general.md")));
});

test("upgrade service cleans safe leftovers even when the bank is already current", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-current-cleanup-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const repository = new BankRepository(bankRoot);
  const projectId = "current-project";

  await repository.ensureStructure();
  await repository.ensureStarterFiles();
  await repository.writeManifest({
    schemaVersion: 1,
    storageVersion: 3,
    bankId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    enabledProviders: [],
    defaultMcpTransport: "stdio",
  });
  await mkdir(path.join(bankRoot, "bin"), { recursive: true });
  await mkdir(path.join(bankRoot, "projects", projectId, "rules", "core"), { recursive: true });
  await mkdir(path.join(bankRoot, "projects", projectId, "rules", "stacks"), { recursive: true });
  await mkdir(path.join(bankRoot, "projects", projectId, "rules", "topics"), { recursive: true });
  await writeFile(path.join(bankRoot, ".DS_Store"), "metadata");
  await writeFile(path.join(bankRoot, "bin", ".DS_Store"), "metadata");
  await writeFile(path.join(bankRoot, "projects", ".DS_Store"), "metadata");

  const result = await new UpgradeService().run({ bankRoot });

  assert.equal(result.status, "already_current");
  await assert.rejects(access(path.join(bankRoot, ".DS_Store")));
  await assert.rejects(access(path.join(bankRoot, "bin", ".DS_Store")));
  await assert.rejects(access(path.join(bankRoot, "projects", ".DS_Store")));
  await assert.rejects(access(path.join(bankRoot, "projects", projectId, "rules", "core")));
  await assert.rejects(access(path.join(bankRoot, "projects", projectId, "rules", "stacks")));
  await assert.rejects(access(path.join(bankRoot, "projects", projectId, "rules", "topics")));
});
