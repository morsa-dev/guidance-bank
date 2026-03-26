import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { z } from "zod";

import { createProjectBankState } from "../src/core/bank/project.js";
import {
  callToolStructured,
  createConnectedClient,
  createInitializedBank,
  initGitRepo,
  TextPayloadSchema,
  writeProjectFiles,
} from "./helpers/mcpTestUtils.js";

const CreateBankSchema = z.object({
  status: z.enum(["created", "already_exists"]),
  syncRequired: z.boolean(),
  projectId: z.string(),
  iteration: z.number(),
  discoveredSources: z.array(
    z.object({
      kind: z.string(),
      entryType: z.string(),
      relativePath: z.string(),
    }),
  ),
  projectEvidence: z.object({
    topLevelDirectories: z.array(z.string()),
    evidenceFiles: z.array(
      z.object({
        kind: z.string(),
        relativePath: z.string(),
      }),
    ),
  }),
  recentCommits: z.array(
    z.object({
      shortHash: z.string(),
      subject: z.string(),
    }),
  ),
  selectedReferenceProjects: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      sharedStacks: z.array(z.string()),
    }),
  ),
  prompt: z.string(),
  creationPrompt: z.string(),
  text: z.string(),
});

test("create_bank iteration 0 scaffolds a project bank and reports discovered inputs", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project", dependencies: { react: "^19.0.0" } }, null, 2),
    "AGENTS.md": "# Local Guidance\n",
    ".cursor/rules.md": "# Cursor Rules\n",
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const structured = await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);

  assert.equal(structured.status, "created");
  assert.equal(structured.syncRequired, false);
  assert.equal(structured.iteration, 0);
  assert.deepEqual(
    structured.discoveredSources.map((source) => source.relativePath),
    [".cursor", ".cursor/rules.md", "AGENTS.md"],
  );
  assert.deepEqual(structured.projectEvidence.topLevelDirectories, []);
  assert.deepEqual(
    structured.projectEvidence.evidenceFiles.map((file) => file.relativePath),
    ["package.json"],
  );
  assert.deepEqual(structured.recentCommits, []);
  assert.match(structured.prompt, /This create flow is iterative/i);
  assert.match(structured.prompt, /review, import, derive, and finalize steps/i);
  assert.match(structured.prompt, /may be reviewed explicitly in later `create_bank` iterations/i);
  assert.doesNotMatch(structured.prompt, /only during explicit bootstrap or sync\/import flows/i);
  assert.match(structured.prompt, /After completing this step, call `create_bank` again with `iteration: 1`/i);
});

test("create_bank later iterations expose review import derive and finalize prompts", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
    "AGENTS.md": "# Local Guidance\n",
    ".cursor/rules.md": "# Cursor Rules\n",
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);

  const reviewStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 1 },
    CreateBankSchema,
  );
  assert.match(reviewStructured.prompt, /choose exactly one action/i);
  assert.match(reviewStructured.prompt, /`ignore`/);
  assert.match(reviewStructured.prompt, /Never delete or rewrite any original source during this review step/i);

  const importStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 2 },
    CreateBankSchema,
  );
  assert.match(importStructured.prompt, /Use MCP mutation tools for all canonical writes/i);
  assert.match(importStructured.prompt, /unless the user explicitly chose `move`/i);

  const deriveProjectStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 3 },
    CreateBankSchema,
  );
  assert.match(deriveProjectStructured.prompt, /## Project Evidence/);
  assert.match(deriveProjectStructured.prompt, /\[config\] package\.json/);

  const deriveDocsStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 4 },
    CreateBankSchema,
  );
  assert.match(deriveDocsStructured.prompt, /## Recent Commits/);

  const finalizeStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 5 },
    CreateBankSchema,
  );
  assert.match(finalizeStructured.prompt, /Final pass checklist/i);
  assert.match(finalizeStructured.prompt, /Leave unresolved or low-confidence items out unless the user explicitly approves them/i);

  const completedStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 6 },
    CreateBankSchema,
  );
  assert.match(completedStructured.prompt, /Create Flow Completed/i);
  assert.match(completedStructured.prompt, /Do not continue the create flow automatically/i);
  assert.doesNotMatch(completedStructured.prompt, /iteration: 7/i);
});

test("resolve_context returns ready context after create_bank without exposing repo-local guidance", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project", dependencies: { react: "^19.0.0" } }, null, 2),
    "AGENTS.md": "# Local Guidance\n",
    ".cursor/rules.md": "# Cursor Rules\n",
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
  const resolveStructured = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);

  assert.match(resolveStructured.text, /Use the following Memory Bank context as the primary user-managed context/i);
  assert.doesNotMatch(resolveStructured.text, /AGENTS\.md/i);
  assert.doesNotMatch(resolveStructured.text, /\.cursor/i);
});

test("create_bank does not clear sync_required for an existing outdated project bank", async (t) => {
  const { tempDirectoryPath, bankRoot, repository } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const firstStructured = await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
  await repository.writeProjectState(firstStructured.projectId, createProjectBankState("ready"));

  const secondStructured = await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
  assert.equal(secondStructured.status, "already_exists");
  assert.equal(secondStructured.syncRequired, true);
  assert.match(secondStructured.prompt, /requires synchronization before reuse/i);

  const resolveStructured = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);
  assert.match(resolveStructured.text, /synchronization is required before using the project-specific bank/i);
});

test("resolve_context suggests similar project banks and create_bank accepts selected references", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const referenceRoot = path.join(tempDirectoryPath, "angular-shared-ui");
  const targetRoot = path.join(tempDirectoryPath, "angular-admin");

  await writeProjectFiles(referenceRoot, {
    "package.json": JSON.stringify(
      {
        name: "angular-shared-ui",
        dependencies: { "@angular/core": "^19.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    ),
    "tsconfig.json": "{}\n",
  });
  await writeProjectFiles(targetRoot, {
    "package.json": JSON.stringify(
      {
        name: "angular-admin",
        dependencies: { "@angular/core": "^19.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    ),
    "tsconfig.json": "{}\n",
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const referenceCreateStructured = await callToolStructured(client, "create_bank", { projectPath: referenceRoot }, CreateBankSchema);
  const resolveStructured = await callToolStructured(
    client,
    "resolve_context",
    { projectPath: targetRoot },
    z.object({
      text: z.string(),
      referenceProjects: z
        .array(
          z.object({
            projectId: z.string(),
            projectName: z.string(),
            sharedStacks: z.array(z.string()),
          }),
        )
        .optional(),
    }),
  );

  assert.equal(resolveStructured.referenceProjects?.length, 1);
  assert.equal(resolveStructured.referenceProjects?.[0]?.projectId, referenceCreateStructured.projectId);

  const targetCreateStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: targetRoot, referenceProjectIds: [referenceCreateStructured.projectId] },
    CreateBankSchema,
  );

  assert.equal(targetCreateStructured.selectedReferenceProjects.length, 1);
  assert.equal(targetCreateStructured.selectedReferenceProjects[0]?.projectId, referenceCreateStructured.projectId);
  assert.match(targetCreateStructured.creationPrompt, /Reference Projects/i);
});

test("create_bank persists requested iteration and overwrites mismatched stored iteration", async (t) => {
  const { tempDirectoryPath, bankRoot, repository } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
    "README.md": "# Demo Project\n",
    "docs/architecture.md": "# Architecture\n",
  });
  await writeProjectFiles(projectRoot, {
    "src/index.ts": "export {};\n",
  });
  await initGitRepo(projectRoot);

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(" "));
  };

  try {
    await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
    const advancedStructured = await callToolStructured(
      client,
      "create_bank",
      { projectPath: projectRoot, iteration: 3 },
      CreateBankSchema,
    );

    assert.equal(advancedStructured.iteration, 3);
    assert.deepEqual(advancedStructured.projectEvidence.topLevelDirectories, ["docs", "src"]);
    assert.deepEqual(
      advancedStructured.projectEvidence.evidenceFiles.map((file) => file.relativePath),
      ["docs/architecture.md", "package.json", "README.md"],
    );
    assert.equal(advancedStructured.recentCommits.length, 1);
    assert.match(advancedStructured.recentCommits[0]?.subject ?? "", /init project/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /iteration mismatch/i);

    const state = await repository.readProjectStateOptional(advancedStructured.projectId);
    assert.equal(state?.createIteration, 3);
  } finally {
    console.warn = originalWarn;
  }
});
