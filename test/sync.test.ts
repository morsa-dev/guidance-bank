import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import test from "node:test";

import { createProjectBankManifest } from "../src/core/bank/project.js";
import { resolveProjectIdentity } from "../src/core/projects/identity.js";
import { InitService } from "../src/core/init/initService.js";
import { SyncService } from "../src/core/sync/syncService.js";
import type { CommandRunner } from "../src/core/providers/types.js";
import { BankRepository } from "../src/storage/bankRepository.js";

const createSuccessfulCommandRunner = (): CommandRunner => async ({ command, args }) => ({
  command,
  args,
  exitCode: command === "codex" && args[1] === "get" ? 1 : command === "claude" && args[1] === "get" ? 1 : 0,
  stdout: "",
  stderr: "",
});

test("sync validates the canonical bank, refreshes project stacks, and reports external guidance sources", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-sync-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const projectRoot = path.join(tempDirectoryPath, "angular-admin");
  const initService = new InitService();
  const syncService = new SyncService();
  const repository = new BankRepository(bankRoot);

  await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "angular-admin",
        dependencies: {
          "@angular/core": "^19.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(projectRoot, "tsconfig.json"), "{}\n");
  await writeFile(path.join(projectRoot, "AGENTS.md"), "# Local Guidance\n");
  await mkdir(path.join(projectRoot, ".cursor"), { recursive: true });

  const identity = resolveProjectIdentity(projectRoot);
  await repository.writeProjectManifest(identity.projectId, createProjectBankManifest(identity.projectId, identity.projectName, identity.projectPath, []));

  const result = await syncService.run({
    bankRoot,
    projectPath: projectRoot,
  });

  assert.equal(result.projectState, "ready");
  assert.equal(result.projectManifestUpdated, true);
  assert.deepEqual(result.detectedStacks, ["nodejs", "typescript", "angular"]);
  assert.equal(result.validatedEntries.shared.rules > 0, true);
  assert.deepEqual(
    result.externalGuidanceSources.map((source) => source.kind).sort(),
    ["agents", "cursor"],
  );

  const updatedManifest = await repository.readProjectManifestOptional(identity.projectId);
  assert.deepEqual(updatedManifest?.detectedStacks, ["nodejs", "typescript", "angular"]);
});

test("sync fails when the bank contains non-canonical entries", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-sync-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const initService = new InitService();
  const syncService = new SyncService();

  await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo-project" }, null, 2));
  await mkdir(path.join(bankRoot, "shared", "rules", "preferences"), { recursive: true });
  await writeFile(
    path.join(bankRoot, "shared", "rules", "preferences", "legacy-rule.md"),
    "# Legacy Rule\n\nThis file intentionally has no canonical frontmatter.\n",
  );

  await assert.rejects(
    () =>
      syncService.run({
        bankRoot,
        projectPath: projectRoot,
      }),
    /Invalid canonical rule at shared\/preferences\/legacy-rule\.md/i,
  );
});
