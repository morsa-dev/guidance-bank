import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { UpgradeService } from "../src/core/upgrade/upgradeService.js";
import type { CommandRunner } from "../src/core/providers/types.js";
import { BankRepository } from "../src/storage/bankRepository.js";
import { createConnectedClient, TextPayloadSchema, callToolStructured, writeProjectFiles } from "./helpers/mcpTestUtils.js";

const createLegacyBankFixture = async (
  enabledProviders: Array<"codex" | "cursor" | "claude-code"> = ["cursor"],
) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-upgrade-"));
  const legacyBankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
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
    { projectPath: projectRoot, sessionRef: "resolve:upgrade-required" },
    TextPayloadSchema,
  );

  assert.equal(resolved.requiredAction, "upgrade_bank");
  assert.equal(resolved.creationState, undefined);
  assert.equal(resolved.recommendedAction, undefined);
  assert.equal(resolved.bankRoot, bankRoot);
  assert.equal(resolved.sourceRoot, legacyBankRoot);
  assert.equal(resolved.storageVersion, 1);
  assert.equal(resolved.expectedStorageVersion, 2);
  assert.match(resolved.text, /AI Guidance Bank update is required before resolving repository context/i);
  assert.match(resolved.text, /Do not start project-bank creation, sync, or normal repository-context work until the bank-level update is complete/i);
});

test("upgrade service migrates a legacy v1 bank, removes legacy MCP registrations, reapplies current integrations, and unblocks normal resolve_context", async (t) => {
  const { bankRoot, cursorConfigRoot, legacyBankRoot, projectRoot } = await createLegacyBankFixture([
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

  const result = await new UpgradeService().run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
  });

  assert.equal(result.status, "upgraded");
  assert.equal(result.bankRoot, bankRoot);
  assert.equal(result.sourceRoot, legacyBankRoot);
  assert.equal(result.migratedBankRoot, true);
  assert.equal(result.previousStorageVersion, 1);
  assert.equal(result.storageVersion, 2);
  assert.deepEqual(result.enabledProviders, ["codex", "cursor", "claude-code"]);
  await assert.rejects(access(legacyBankRoot));

  const upgradedRepository = new BankRepository(bankRoot);
  const upgradedManifest = await upgradedRepository.readManifest();
  assert.equal(upgradedManifest.storageVersion, 2);
  assert.deepEqual(upgradedManifest.enabledProviders, ["codex", "cursor", "claude-code"]);

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
    { projectPath: projectRoot, sessionRef: "resolve:after-upgrade" },
    TextPayloadSchema,
  );

  assert.equal(resolved.requiredAction, undefined);
  assert.equal(resolved.creationState, "unknown");
  assert.equal(resolved.recommendedAction, "create_bank");
  assert.equal(resolved.sourceRoot, undefined);
  assert.match(resolved.text, /No project AI Guidance Bank exists for this repository yet/i);
  assert.doesNotMatch(resolved.text, /update is required before resolving repository context/i);
});
