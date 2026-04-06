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
  phase: z.string(),
  iteration: z.number(),
  creationState: z.enum(["unknown", "declined", "creating", "ready"]),
  stepCompletionRequired: z.boolean(),
  mustContinue: z.boolean(),
  nextIteration: z.number().int().nonnegative().nullable(),
  existingBankUpdatedAt: z.string().nullable(),
  existingBankUpdatedDaysAgo: z.number().int().nonnegative().nullable(),
  applyResults: z.object({
    writes: z.array(
      z.object({
        kind: z.enum(["rules", "skills"]),
        scope: z.enum(["shared", "project"]),
        path: z.string(),
        status: z.enum(["created", "updated", "conflict"]),
        expectedSha256: z.string().nullable(),
        actualSha256: z.string().nullable(),
      }),
    ),
    deletions: z.array(
      z.object({
        kind: z.enum(["rules", "skills"]),
        scope: z.enum(["shared", "project"]),
        path: z.string(),
        status: z.enum(["deleted", "not_found", "conflict"]),
        expectedSha256: z.string().nullable(),
        actualSha256: z.string().nullable(),
      }),
    ),
  }),
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
  currentBankSnapshot: z.object({
    exists: z.boolean(),
    entries: z.array(
      z.object({
        kind: z.enum(["rules", "skills"]),
        scope: z.literal("project"),
        path: z.string(),
        id: z.string(),
        sha256: z.string(),
      }),
    ),
  }),
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
  assert.equal(structured.phase, "kickoff");
  assert.equal(structured.iteration, 0);
  assert.equal(structured.creationState, "creating");
  assert.equal(structured.stepCompletionRequired, false);
  assert.equal(structured.mustContinue, true);
  assert.equal(structured.nextIteration, 1);
  assert.equal(
    structured.text,
    "Call create_bank with iteration: 1 and stepCompleted: true after the current step is complete.",
  );
  assert.deepEqual(
    structured.discoveredSources.map((source) => source.relativePath),
    [".cursor", ".cursor/rules.md", "AGENTS.md"],
  );
  assert.deepEqual(structured.projectEvidence.topLevelDirectories, []);
  assert.deepEqual(
    structured.projectEvidence.evidenceFiles.map((file) => file.relativePath),
    ["package.json"],
  );
  assert.equal(structured.currentBankSnapshot.exists, true);
  assert.deepEqual(structured.currentBankSnapshot.entries, []);
  assert.deepEqual(structured.applyResults, { writes: [], deletions: [] });
  assert.match(structured.prompt, /Create Flow Kickoff/i);
  assert.match(structured.prompt, /stable create-flow contract/i);
  assert.match(structured.prompt, /do not import or delete repository-local guidance yet/i);
  assert.doesNotMatch(structured.prompt, /Supported Stack Ids/i);
  assert.doesNotMatch(structured.prompt, /Expected Bank Density/i);
  assert.match(structured.creationPrompt, /Supported Stack Ids/i);
  assert.match(structured.creationPrompt, /- other/);
  assert.match(structured.creationPrompt, /Expected Bank Density/i);
  assert.match(structured.creationPrompt, /2-6 focused rule files/i);
  assert.match(
    structured.prompt,
    /After completing this step, call `create_bank` again with `iteration: 1` and `stepCompleted: true`/i,
  );
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

  const blockedReviewStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 1 },
    CreateBankSchema,
  );
  assert.equal(blockedReviewStructured.iteration, 0);
  assert.equal(blockedReviewStructured.phase, "kickoff");
  assert.equal(blockedReviewStructured.stepCompletionRequired, true);
  assert.equal(
    blockedReviewStructured.text,
    "Mark the current create step complete before advancing. Re-call create_bank with iteration: 1 and stepCompleted: true once the current step is actually done.",
  );
  assert.match(blockedReviewStructured.prompt, /Create Flow Kickoff/i);

  const reviewStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 1, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(reviewStructured.iteration, 1);
  assert.equal(reviewStructured.phase, "review_existing_guidance");
  assert.equal(reviewStructured.stepCompletionRequired, false);
  assert.match(reviewStructured.prompt, /stable create-flow contract/i);
  assert.match(reviewStructured.prompt, /source-level picture of guidance/i);
  assert.match(reviewStructured.prompt, /choose one strategy per meaningful source/i);
  assert.match(reviewStructured.prompt, /`keep source, fill gaps in bank`/);
  assert.match(reviewStructured.prompt, /Never delete or rewrite any original source during this review step/i);

  const importStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 2, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(importStructured.iteration, 2);
  assert.equal(importStructured.phase, "import_selected_guidance");
  assert.equal(importStructured.stepCompletionRequired, false);
  assert.match(importStructured.prompt, /stable create-flow contract/i);
  assert.match(importStructured.prompt, /Apply the source-level strategies/i);
  assert.match(importStructured.prompt, /Use `create_bank` with an `apply` payload/i);
  assert.match(importStructured.prompt, /keep source, fill gaps in bank/i);

  const deriveProjectStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 3, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(deriveProjectStructured.iteration, 3);
  assert.equal(deriveProjectStructured.phase, "derive_from_project");
  assert.match(deriveProjectStructured.prompt, /stable create-flow contract/i);
  assert.match(deriveProjectStructured.prompt, /## Project Evidence/);
  assert.match(deriveProjectStructured.prompt, /\[config\] package\.json/);
  assert.match(deriveProjectStructured.prompt, /Rule Quality Gate/i);
  assert.match(deriveProjectStructured.prompt, /Node\.js Backend Guidance/i);
  assert.match(deriveProjectStructured.prompt, /Apply derived changes through `create_bank\.apply` in batches/i);

  const finalizeStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 4, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(finalizeStructured.phase, "finalize");
  assert.equal(finalizeStructured.creationState, "creating");
  assert.equal(finalizeStructured.stepCompletionRequired, false);
  assert.equal(finalizeStructured.mustContinue, true);
  assert.equal(finalizeStructured.nextIteration, 5);
  assert.equal(
    finalizeStructured.text,
    "Call create_bank with iteration: 5 and stepCompleted: true after the current step is complete.",
  );
  assert.match(finalizeStructured.prompt, /stable create-flow contract/i);
  assert.match(finalizeStructured.prompt, /Final pass checklist/i);
  assert.match(finalizeStructured.prompt, /Leave unresolved or low-confidence items out unless the user explicitly approves them/i);
  assert.match(finalizeStructured.prompt, /Use `create_bank\.apply` for the final cleanup batch/i);
  assert.match(
    finalizeStructured.prompt,
    /After completing this step, call `create_bank` again with `iteration: 5` and `stepCompleted: true`/i,
  );

  const completedStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 5, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(completedStructured.phase, "completed");
  assert.equal(completedStructured.creationState, "ready");
  assert.equal(completedStructured.stepCompletionRequired, false);
  assert.equal(completedStructured.mustContinue, false);
  assert.equal(completedStructured.nextIteration, null);
  assert.match(completedStructured.prompt, /Create Flow Completed/i);
  assert.match(completedStructured.prompt, /Do not continue the create flow automatically/i);
  assert.doesNotMatch(completedStructured.prompt, /iteration: 6/i);
});

test("create_bank can apply batched writes for the current step and refresh the snapshot", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
  await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 1, stepCompleted: true },
    CreateBankSchema,
  );
  await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 2, stepCompleted: true },
    CreateBankSchema,
  );
  await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 3, stepCompleted: true },
    CreateBankSchema,
  );

  const applied = await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 3,
      apply: {
        writes: [
          {
            kind: "rules",
            scope: "project",
            path: "core/general.md",
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stacks: [other]
topics: [architecture]
---

- Keep the project bank canonical.
`,
          },
          {
            kind: "skills",
            scope: "project",
            path: "adding-feature",
            content: `---
id: demo-project-adding-feature
kind: skill
title: Adding Feature
description: Add a feature in this demo project.
stacks: [other]
topics: [workflow]
---

## When to use

When adding a feature.

## Workflow

1. Read the project.
2. Implement the feature.
`,
          },
        ],
        deletions: [],
      },
    },
    CreateBankSchema,
  );

  assert.equal(applied.phase, "derive_from_project");
  assert.equal(applied.iteration, 3);
  assert.equal(applied.applyResults.writes.length, 2);
  assert.deepEqual(
    applied.applyResults.writes.map((item) => [item.kind, item.scope, item.status]),
    [
      ["rules", "project", "created"],
      ["skills", "project", "created"],
    ],
  );
  assert.deepEqual(applied.applyResults.deletions, []);
  assert.equal(applied.currentBankSnapshot.exists, true);
  assert.equal(applied.currentBankSnapshot.entries.length, 2);
  assert.match(applied.text, /Create-flow changes were applied/i);

  const projectRule = await callToolStructured(
    client,
    "read_entry",
    { scope: "project", projectPath: projectRoot, kind: "rules", path: "core/general.md" },
    z.object({ path: z.string(), content: z.string() }),
  );
  assert.match(projectRule.content, /Demo Project General Rules/);
});

test("resolve_context blocks normal runtime context until the create flow is completed", async (t) => {
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
  const inProgressStructured = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);

  assert.equal(inProgressStructured.creationState, "creating");
  assert.equal(inProgressStructured.requiredAction, "continue_create_bank");
  assert.equal(inProgressStructured.nextIteration, 1);
  assert.equal(
    inProgressStructured.text,
    "Call `create_bank` with `iteration: 1` and `stepCompleted: true` after the current step is actually complete.",
  );
  assert.doesNotMatch(inProgressStructured.text, /AGENTS\.md/i);
  assert.doesNotMatch(inProgressStructured.text, /\.cursor/i);

  for (const iteration of [1, 2, 3, 4, 5]) {
    await callToolStructured(client, "create_bank", { projectPath: projectRoot, iteration, stepCompleted: true }, CreateBankSchema);
  }
  const resolveStructured = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);

  assert.equal(resolveStructured.creationState, "ready");
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
  assert.equal(secondStructured.phase, "sync_required");
  assert.match(secondStructured.prompt, /requires synchronization before reuse/i);
  assert.match(secondStructured.prompt, /does not create or improve project content/i);
  assert.equal(
    secondStructured.text,
    "Call sync_bank to reconcile the existing project bank before any create or improve flow.",
  );

  const resolveStructured = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);
  assert.match(resolveStructured.text, /synchronization is required before using the project-specific bank/i);
});

test("ready project banks ask the user whether to run an improvement pass before continuing", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
  for (const iteration of [1, 2, 3, 4, 5]) {
    await callToolStructured(client, "create_bank", { projectPath: projectRoot, iteration, stepCompleted: true }, CreateBankSchema);
  }

  const rerunStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot },
    CreateBankSchema,
  );

  assert.equal(rerunStructured.creationState, "ready");
  assert.equal(rerunStructured.phase, "ready_to_improve");
  assert.equal(rerunStructured.stepCompletionRequired, false);
  assert.equal(rerunStructured.mustContinue, false);
  assert.equal(rerunStructured.nextIteration, 1);
  assert.equal(
    rerunStructured.text,
    "Project Memory Bank already exists. Ask the user whether to improve it. If they agree, call create_bank with iteration: 1.",
  );
  assert.match(rerunStructured.prompt, /last updated 0 days ago/i);
  assert.match(rerunStructured.prompt, /Ask whether they want to improve it now/i);
  assert.equal(rerunStructured.existingBankUpdatedDaysAgo, 0);
  assert.deepEqual(rerunStructured.discoveredSources, []);
  assert.deepEqual(rerunStructured.projectEvidence.topLevelDirectories, []);
  assert.deepEqual(rerunStructured.projectEvidence.evidenceFiles, []);
  assert.equal(rerunStructured.currentBankSnapshot.exists, true);
  assert.deepEqual(rerunStructured.currentBankSnapshot.entries, []);

  const improveStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 1 },
    CreateBankSchema,
  );
  assert.equal(improveStructured.creationState, "ready");
  assert.equal(improveStructured.phase, "review_existing_guidance");
  assert.equal(improveStructured.stepCompletionRequired, false);
  assert.equal(improveStructured.mustContinue, true);
  assert.equal(improveStructured.nextIteration, 2);
  assert.match(improveStructured.prompt, /Current Bank Baseline/i);
  assert.match(improveStructured.prompt, /Treat the current project bank as the canonical baseline/i);

  const resolveStructured = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);
  assert.equal(resolveStructured.creationState, "ready");
  assert.match(resolveStructured.text, /Use the following Memory Bank context as the primary user-managed context/i);
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

test("create_bank blocks advancing to a later step without explicit completion confirmation", async (t) => {
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

    assert.equal(advancedStructured.iteration, 0);
    assert.equal(advancedStructured.stepCompletionRequired, true);
    assert.deepEqual(advancedStructured.projectEvidence.topLevelDirectories, ["docs", "src"]);
    assert.deepEqual(
      advancedStructured.projectEvidence.evidenceFiles.map((file) => file.relativePath),
      ["docs/architecture.md", "package.json", "README.md"],
    );
    assert.equal(warnings.length, 0);

    const state = await repository.readProjectStateOptional(advancedStructured.projectId);
    assert.equal(state?.createIteration, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test("create_bank returns compact current project bank snapshot and project entries are readable by path", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
  await callToolStructured(client, "create_bank", { projectPath: projectRoot, iteration: 1, stepCompleted: true }, CreateBankSchema);

  await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "project",
      projectPath: projectRoot,
      path: "topics/architecture.md",
      content:
        "---\nid: project-architecture\nkind: rule\ntitle: Project Architecture\nstacks: []\ntopics: [architecture]\n---\n\n# Project Architecture\n\n- Keep project layers explicit.\n",
    },
    z.object({ status: z.enum(["created", "updated"]) }),
  );

  const snapshotStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 2, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(snapshotStructured.currentBankSnapshot.exists, true);
  assert.equal(snapshotStructured.currentBankSnapshot.entries.length, 1);
  assert.equal(snapshotStructured.currentBankSnapshot.entries[0]?.path, "topics/architecture.md");
  assert.equal(snapshotStructured.currentBankSnapshot.entries[0]?.id, "project-architecture");

  const listed = await callToolStructured(
    client,
    "list_entries",
    { scope: "project", projectPath: projectRoot, kind: "rules" },
    z.object({
      scope: z.literal("project"),
      kind: z.literal("rules"),
      projectPath: z.string(),
      entries: z.array(z.object({ path: z.string() })),
    }),
  );
  assert.deepEqual(listed.entries.map((entry) => entry.path), ["topics/architecture.md"]);

  const read = await callToolStructured(
    client,
    "read_entry",
    { scope: "project", projectPath: projectRoot, kind: "rules", path: "topics/architecture.md" },
    z.object({
      scope: z.literal("project"),
      kind: z.literal("rules"),
      projectPath: z.string(),
      path: z.string(),
      content: z.string(),
    }),
  );
  assert.match(read.content, /Keep project layers explicit\./);
});
