import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import { createProjectBankState } from "../src/core/bank/project.js";
import {
  callToolResult,
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
  confirmedSourceStrategies: z.array(
    z.object({
      sourceRef: z.string(),
      strategy: z.enum(["ignore", "copy", "move", "keep_source_fill_gaps", "keep_provider_native"]),
      note: z.string().nullable(),
    }),
  ),
  stepCompletionRequired: z.boolean(),
  sourceStrategyRequired: z.boolean(),
  stepOutcomeRequired: z.boolean(),
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
      scope: z.string(),
      relativePath: z.string(),
      fingerprint: z.string(),
    }),
  ),
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
  creationPrompt: z.string().nullable(),
  text: z.string(),
});

const withTemporaryHome = async <T>(homePath: string, run: () => Promise<T>): Promise<T> => {
  const previousHome = process.env.HOME;
  process.env.HOME = homePath;

  try {
    return await run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
};

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
  assert.equal(structured.stepOutcomeRequired, false);
  assert.equal(structured.mustContinue, true);
  assert.equal(structured.nextIteration, 1);
  assert.equal(
    structured.text,
    "Continue the create flow at phase `kickoff`. Use `phase` as the primary guide, treat `iteration` as diagnostic only, and prefer `create_bank.apply` for writes inside the guided flow. Call create_bank with iteration: 1 and stepCompleted: true after the current step is complete. For content phases, also provide an explicit step outcome: use `create_bank.apply` for changes or set `stepOutcome` when no new mutations are needed.",
  );
  assert.deepEqual(
    structured.discoveredSources.map((source) => source.relativePath),
    [".cursor", ".cursor/rules.md", "AGENTS.md"],
  );
  assert.equal(structured.currentBankSnapshot.exists, true);
  assert.deepEqual(structured.currentBankSnapshot.entries, []);
  assert.deepEqual(structured.applyResults, { writes: [], deletions: [] });
  assert.match(structured.prompt, /Create Flow Kickoff/i);
  assert.match(structured.prompt, /stable create-flow contract/i);
  assert.match(structured.prompt, /delay external guidance import or deletion until the dedicated review step/i);
  assert.doesNotMatch(structured.prompt, /Entry Selector/i);
  assert.match(structured.creationPrompt ?? "", /Entry Selector/i);
  assert.match(structured.creationPrompt ?? "", /- other/);
  assert.doesNotMatch(structured.creationPrompt ?? "", /Expected Bank Density/i);
  assert.doesNotMatch(structured.creationPrompt ?? "", /Coverage Expectations/i);
  assert.match(
    structured.prompt,
    /After completing this step, call `create_bank` again with `iteration: 1` and `stepCompleted: true`/i,
  );
});

test("create_bank discovers codex project guidance and keeps Cursor rules repository-local", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const fakeHome = path.join(tempDirectoryPath, "fake-home");
  const codexProjectSkillsRoot = path.join(fakeHome, ".codex", "skills", "projects", "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
    ".cursor/rules/architecture.mdc": "# Cursor Architecture\n",
    ".cursorrules": "# Legacy Cursor Rules\n",
  });

  await mkdir(path.join(codexProjectSkillsRoot, "routing-seo-ssr"), { recursive: true });
  await writeFile(
    path.join(codexProjectSkillsRoot, "routing-seo-ssr", "SKILL.md"),
    "---\nname: routing-seo-ssr\ndescription: demo\n---\n",
  );

  const structured = await withTemporaryHome(fakeHome, async () => {
    const { client, close } = await createConnectedClient(bankRoot);
    t.after(close);

    return callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
  });

  assert.deepEqual(
    structured.discoveredSources
      .filter((source) => source.kind === "codex-project")
      .map((source) => source.relativePath),
    [
      "~/.codex/skills/projects/demo-project",
      "~/.codex/skills/projects/demo-project/routing-seo-ssr/SKILL.md",
    ],
  );
  assert.equal(
    structured.discoveredSources.some((source) => source.relativePath === ".cursor/rules/architecture.mdc"),
    true,
  );
  assert.equal(structured.discoveredSources.some((source) => source.relativePath === ".cursorrules"), true);
});

test("create_bank discovers provider-global guidance and remembers review decisions", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const otherProjectRoot = path.join(tempDirectoryPath, "other-project");
  const changedProjectRoot = path.join(tempDirectoryPath, "changed-project");
  const fakeHome = path.join(tempDirectoryPath, "fake-home");
  const codexGlobalSkillRoot = path.join(fakeHome, ".codex", "skills", "language-rules");
  const codexSystemSkillRoot = path.join(fakeHome, ".codex", "skills", ".system", "internal");
  const codexOtherProjectSkillRoot = path.join(fakeHome, ".codex", "skills", "projects", "other-project", "other-skill");
  const claudeGlobalRoot = path.join(fakeHome, ".claude");
  const claudeGlobalRulesRoot = path.join(claudeGlobalRoot, "rules");
  const claudeGlobalSkillRoot = path.join(claudeGlobalRoot, "skills", "explain-code");
  const claudeGlobalCommandsRoot = path.join(claudeGlobalRoot, "commands");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });
  await writeProjectFiles(otherProjectRoot, {
    "package.json": JSON.stringify({ name: "other-project" }, null, 2),
  });
  await writeProjectFiles(changedProjectRoot, {
    "package.json": JSON.stringify({ name: "changed-project" }, null, 2),
  });

  await mkdir(codexGlobalSkillRoot, { recursive: true });
  await writeFile(path.join(codexGlobalSkillRoot, "SKILL.md"), "# Codex Global Language Rules\n");
  await mkdir(codexSystemSkillRoot, { recursive: true });
  await writeFile(path.join(codexSystemSkillRoot, "SKILL.md"), "# Hidden System Skill\n");
  await mkdir(codexOtherProjectSkillRoot, { recursive: true });
  await writeFile(path.join(codexOtherProjectSkillRoot, "SKILL.md"), "# Other Project Skill\n");
  await mkdir(claudeGlobalRoot, { recursive: true });
  await writeFile(path.join(claudeGlobalRoot, "CLAUDE.md"), "# Claude Global Rules\n");
  await mkdir(claudeGlobalRulesRoot, { recursive: true });
  await writeFile(path.join(claudeGlobalRulesRoot, "preferences.md"), "# Claude Preferences\n");
  await mkdir(claudeGlobalSkillRoot, { recursive: true });
  await writeFile(path.join(claudeGlobalSkillRoot, "SKILL.md"), "---\nname: explain-code\n---\n");
  await mkdir(claudeGlobalCommandsRoot, { recursive: true });
  await writeFile(path.join(claudeGlobalCommandsRoot, "review.md"), "# Claude Review Command\n");

  await withTemporaryHome(fakeHome, async () => {
    const { client, close } = await createConnectedClient(bankRoot);
    t.after(close);

    const structured = await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
    const providerGlobalSources = structured.discoveredSources.filter((source) => source.scope === "provider-global");

    assert.deepEqual(
      providerGlobalSources.map((source) => source.relativePath),
      [
        "~/.claude/CLAUDE.md",
        "~/.claude/commands",
        "~/.claude/commands/review.md",
        "~/.claude/rules",
        "~/.claude/rules/preferences.md",
        "~/.claude/skills/explain-code",
        "~/.claude/skills/explain-code/SKILL.md",
        "~/.codex/skills/language-rules",
        "~/.codex/skills/language-rules/SKILL.md",
      ],
    );
    assert.equal(providerGlobalSources.every((source) => source.fingerprint.length > 0), true);
    assert.equal(
      structured.discoveredSources.some((source) => source.relativePath.includes(".system")),
      false,
    );
    assert.equal(
      structured.discoveredSources.some((source) => source.relativePath.includes("projects/other-project")),
      false,
    );

    await callToolStructured(
      client,
      "create_bank",
      { projectPath: projectRoot, iteration: 1, stepCompleted: true },
      CreateBankSchema,
    );
    const importStructured = await callToolStructured(
      client,
      "create_bank",
      {
        projectPath: projectRoot,
        iteration: 2,
        stepCompleted: true,
        sourceReviewDecision: "ok",
      },
      CreateBankSchema,
    );

    assert.deepEqual(
      importStructured.confirmedSourceStrategies
        .filter(
          (strategy) =>
            strategy.sourceRef.includes("language-rules") ||
            strategy.sourceRef.includes("CLAUDE.md") ||
            strategy.sourceRef.includes("preferences.md"),
        )
        .map((strategy) => [strategy.sourceRef, strategy.strategy]),
      [
        ["~/.claude/CLAUDE.md", "copy"],
        ["~/.claude/rules/preferences.md", "copy"],
        ["~/.codex/skills/language-rules", "ignore"],
        ["~/.codex/skills/language-rules/SKILL.md", "copy"],
      ],
    );
    assert.match(importStructured.prompt, /provider-global sources confirmed by `ok`/i);
    assert.match(importStructured.prompt, /Never call `delete_guidance_source` for provider-global sources/i);

    await callToolStructured(
      client,
      "create_bank",
      {
        projectPath: projectRoot,
        iteration: 3,
        stepCompleted: true,
        stepOutcome: "no_changes",
        stepOutcomeNote: "Provider-global guidance was reviewed for this test and no additional import was needed.",
      },
      CreateBankSchema,
    );

    const decisions = JSON.parse(
      await readFile(path.join(bankRoot, "external-guidance-decisions.json"), "utf8"),
    ) as {
      sources: Record<string, { decision: string; fingerprint: string; sourceRef: string }>;
    };
    const codexGlobalDecision = Object.values(decisions.sources).find(
      (decision) => decision.sourceRef === "~/.codex/skills/language-rules/SKILL.md",
    );

    assert.equal(codexGlobalDecision?.decision, "copy_to_shared_keep_source");
    assert.equal(typeof codexGlobalDecision?.fingerprint, "string");

    const otherProjectStructured = await callToolStructured(
      client,
      "create_bank",
      { projectPath: otherProjectRoot },
      CreateBankSchema,
    );

    assert.equal(
      otherProjectStructured.discoveredSources.some((source) => source.scope === "provider-global"),
      false,
    );
    assert.equal(
      otherProjectStructured.discoveredSources.some((source) => source.relativePath.includes("projects/other-project")),
      true,
    );

    await writeFile(path.join(codexGlobalSkillRoot, "SKILL.md"), "# Codex Global Language Rules\n\nChanged later.\n");
    const changedProjectStructured = await callToolStructured(
      client,
      "create_bank",
      { projectPath: changedProjectRoot },
      CreateBankSchema,
    );

    assert.equal(
      changedProjectStructured.discoveredSources.some(
        (source) => source.relativePath === "~/.codex/skills/language-rules/SKILL.md",
      ),
      true,
    );
    assert.equal(
      changedProjectStructured.discoveredSources.some((source) => source.relativePath === "~/.claude/CLAUDE.md"),
      false,
    );
  });
});

test("create_bank remembers provider-global not-ok decisions without importing", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const laterProjectRoot = path.join(tempDirectoryPath, "later-project");
  const fakeHome = path.join(tempDirectoryPath, "fake-home");
  const codexGlobalSkillRoot = path.join(fakeHome, ".codex", "skills", "typescript-diagnostics");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });
  await writeProjectFiles(laterProjectRoot, {
    "package.json": JSON.stringify({ name: "later-project" }, null, 2),
  });
  await mkdir(codexGlobalSkillRoot, { recursive: true });
  await writeFile(path.join(codexGlobalSkillRoot, "SKILL.md"), "# TypeScript Diagnostics\n");

  await withTemporaryHome(fakeHome, async () => {
    const { client, close } = await createConnectedClient(bankRoot);
    t.after(close);

    await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
    await callToolStructured(
      client,
      "create_bank",
      { projectPath: projectRoot, iteration: 1, stepCompleted: true },
      CreateBankSchema,
    );
    const importStructured = await callToolStructured(
      client,
      "create_bank",
      {
        projectPath: projectRoot,
        iteration: 2,
        stepCompleted: true,
        sourceReviewDecision: "not_ok",
      },
      CreateBankSchema,
    );

    assert.deepEqual(
      importStructured.confirmedSourceStrategies
        .filter((strategy) => strategy.sourceRef.includes("typescript-diagnostics"))
        .map((strategy) => [strategy.sourceRef, strategy.strategy]),
      [
        ["~/.codex/skills/typescript-diagnostics", "ignore"],
        ["~/.codex/skills/typescript-diagnostics/SKILL.md", "keep_provider_native"],
      ],
    );

    const decisions = JSON.parse(
      await readFile(path.join(bankRoot, "external-guidance-decisions.json"), "utf8"),
    ) as {
      sources: Record<string, { decision: string; sourceRef: string }>;
    };
    const codexGlobalDecision = Object.values(decisions.sources).find(
      (decision) => decision.sourceRef === "~/.codex/skills/typescript-diagnostics/SKILL.md",
    );

    assert.equal(codexGlobalDecision?.decision, "keep_provider_native");

    const laterStructured = await callToolStructured(
      client,
      "create_bank",
      { projectPath: laterProjectRoot },
      CreateBankSchema,
    );

    assert.equal(
      laterStructured.discoveredSources.some((source) => source.scope === "provider-global"),
      false,
    );
  });
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
  assert.equal(blockedReviewStructured.stepOutcomeRequired, false);
  assert.equal(
    blockedReviewStructured.text,
    "Mark the current create step complete before advancing from phase `kickoff`. Use `phase` as the primary guide and treat `iteration` as diagnostic only. Re-call create_bank with iteration: 1 and stepCompleted: true once the current step is actually done.",
  );
  assert.match(blockedReviewStructured.prompt, /Create Flow Kickoff/i);
  assert.match(blockedReviewStructured.prompt, /Use `phase` as the main guide/i);
  assert.match(blockedReviewStructured.text, /Use `phase` as the primary guide/i);
  assert.match(blockedReviewStructured.creationPrompt ?? "", /Entry Selector/i);

  const reviewStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 1, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(reviewStructured.iteration, 1);
  assert.equal(reviewStructured.phase, "review_existing_guidance");
  assert.equal(reviewStructured.stepCompletionRequired, false);
  assert.equal(reviewStructured.sourceStrategyRequired, false);
  assert.equal(reviewStructured.stepOutcomeRequired, false);
  assert.match(reviewStructured.prompt, /If `creationPrompt` is present, use it as the stable create-flow contract/i);
  assert.match(reviewStructured.prompt, /by default, do not expose internal strategy labels/i);
  assert.match(reviewStructured.prompt, /short and action-oriented/i);
  assert.match(reviewStructured.prompt, /one explicit CTA question/i);
  assert.match(reviewStructured.prompt, /recommend one default action/i);
  assert.match(reviewStructured.prompt, /sourceReviewDecision: "ok"/i);
  assert.match(reviewStructured.prompt, /detailed follow-up/i);
  assert.match(reviewStructured.prompt, /Never delete or rewrite any original source during this review step/i);
  assert.equal(reviewStructured.creationPrompt, null);
  assert.match(reviewStructured.text, /phase `review_existing_guidance`/i);

  const blockedImportStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 2, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(blockedImportStructured.iteration, 1);
  assert.equal(blockedImportStructured.phase, "review_existing_guidance");
  assert.equal(blockedImportStructured.stepCompletionRequired, false);
  assert.equal(blockedImportStructured.sourceStrategyRequired, true);
  assert.equal(blockedImportStructured.stepOutcomeRequired, false);
  assert.match(blockedImportStructured.text, /Record an external guidance review decision/i);
  assert.match(blockedImportStructured.text, /sourceReviewDecision/i);

  const importStructured = await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 2,
      stepCompleted: true,
      sourceReviewDecision: "ok",
    },
    CreateBankSchema,
  );
  assert.equal(importStructured.iteration, 2);
  assert.equal(importStructured.phase, "import_selected_guidance");
  assert.equal(importStructured.stepCompletionRequired, false);
  assert.equal(importStructured.sourceStrategyRequired, false);
  assert.equal(importStructured.stepOutcomeRequired, false);
  assert.deepEqual(
    importStructured.confirmedSourceStrategies.map((item) => [item.sourceRef, item.strategy]),
    [
      [".cursor", "ignore"],
      [".cursor/rules.md", "move"],
      ["AGENTS.md", "move"],
    ],
  );
  assert.match(importStructured.prompt, /If `creationPrompt` is present, use it as the stable create-flow contract/i);
  assert.match(importStructured.prompt, /internal execution plan/i);
  assert.match(importStructured.prompt, /Confirmed Source Decisions/i);
  assert.match(importStructured.prompt, /Use `create_bank` with an `apply` payload/i);
  assert.match(importStructured.prompt, /If the user simply confirmed `ok`/i);
  assert.match(importStructured.prompt, /Write reusable cross-project rules or skills to `scope: "shared"`/i);
  assert.match(importStructured.prompt, /Legacy Source Cleanup Contract/i);
  assert.match(importStructured.prompt, /call `delete_guidance_source` with the discovered absolute `sourcePath`/i);
  assert.match(importStructured.prompt, /provider-project sources such as Codex project skills/i);
  assert.match(importStructured.prompt, /stepOutcome` to `applied` or `no_changes`/i);
  assert.equal(importStructured.creationPrompt, null);

  const blockedDeriveStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 3, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(blockedDeriveStructured.iteration, 2);
  assert.equal(blockedDeriveStructured.phase, "import_selected_guidance");
  assert.equal(blockedDeriveStructured.stepCompletionRequired, false);
  assert.equal(blockedDeriveStructured.stepOutcomeRequired, true);
  assert.match(blockedDeriveStructured.text, /Record an explicit outcome for phase `import_selected_guidance`/i);

  const deriveProjectStructured = await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance needed importing for this test project.",
    },
    CreateBankSchema,
  );
  assert.equal(deriveProjectStructured.iteration, 3);
  assert.equal(deriveProjectStructured.phase, "derive_from_project");
  assert.equal(deriveProjectStructured.stepOutcomeRequired, false);
  assert.match(deriveProjectStructured.prompt, /Use `phase` as the main guide/i);
  assert.match(deriveProjectStructured.prompt, /Inspect the real repository directly/i);
  assert.match(deriveProjectStructured.prompt, /Do not rely on a server-provided file checklist/i);
  assert.match(deriveProjectStructured.prompt, /Rule Quality Gate/i);
  assert.match(deriveProjectStructured.prompt, /Node\.js Backend Guidance/i);
  assert.match(deriveProjectStructured.prompt, /Infer the project archetype from the real repository/i);
  assert.match(deriveProjectStructured.prompt, /at least 5 focused rule files/i);
  assert.match(deriveProjectStructured.prompt, /minimum expectations, not caps/i);
  assert.match(deriveProjectStructured.prompt, /Candidate Derivation Requirements/i);
  assert.match(deriveProjectStructured.prompt, /key multi-step workflows: identify at least 2/i);
  assert.match(deriveProjectStructured.prompt, /duplicate existing guidance, restate weak evidence, or split the bank into overly fine-grained fragments/i);
  assert.match(deriveProjectStructured.prompt, /Apply derived changes through `create_bank\.apply` in batches/i);
  assert.match(deriveProjectStructured.prompt, /stepOutcome` to `applied` or `no_changes`/i);
  assert.equal(deriveProjectStructured.creationPrompt, null);

  const blockedFinalizeStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 4, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(blockedFinalizeStructured.iteration, 3);
  assert.equal(blockedFinalizeStructured.phase, "derive_from_project");
  assert.equal(blockedFinalizeStructured.stepOutcomeRequired, true);
  assert.match(blockedFinalizeStructured.text, /Record an explicit outcome for phase `derive_from_project`/i);

  const finalizeStructured = await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 4,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No additional derived rules were needed for this test project.",
    },
    CreateBankSchema,
  );
  assert.equal(finalizeStructured.phase, "finalize");
  assert.equal(finalizeStructured.creationState, "creating");
  assert.equal(finalizeStructured.stepCompletionRequired, false);
  assert.equal(finalizeStructured.stepOutcomeRequired, false);
  assert.equal(finalizeStructured.mustContinue, true);
  assert.equal(finalizeStructured.nextIteration, 5);
  assert.match(finalizeStructured.text, /Continue the create flow at phase `finalize`/i);
  assert.match(finalizeStructured.text, /strongest skipped or already-covered high-value candidates/i);
  assert.match(finalizeStructured.text, /coverage categories/i);
  assert.match(finalizeStructured.prompt, /Use `phase` as the main guide/i);
  assert.match(finalizeStructured.prompt, /Final pass checklist/i);
  assert.match(
    finalizeStructured.prompt,
    /covered by a project entry, covered well enough by shared guidance, or intentionally skipped with a short reason/i,
  );
  assert.match(
    finalizeStructured.prompt,
    /duplicate existing guidance, restate weak evidence, or split the bank into overly fine-grained fragments/i,
  );
  assert.match(finalizeStructured.prompt, /Leave unresolved or low-confidence items out unless the user explicitly approves them/i);
  assert.match(finalizeStructured.prompt, /Move entries into shared scope when they are provider-independent/i);
  assert.match(finalizeStructured.prompt, /Use `create_bank\.apply` for the final cleanup batch/i);
  assert.match(finalizeStructured.prompt, /Legacy Source Cleanup Contract/i);
  assert.match(finalizeStructured.prompt, /no migrated provider-project guidance source still duplicates canonical bank content/i);
  assert.equal(finalizeStructured.creationPrompt, null);
  assert.match(
    finalizeStructured.prompt,
    /After completing this step, call `create_bank` again with `iteration: 5` and `stepCompleted: true`/i,
  );
  assert.match(finalizeStructured.prompt, /stepOutcome` to `applied` or `no_changes`/i);

  const blockedCompletedStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot, iteration: 5, stepCompleted: true },
    CreateBankSchema,
  );
  assert.equal(blockedCompletedStructured.iteration, 4);
  assert.equal(blockedCompletedStructured.phase, "finalize");
  assert.equal(blockedCompletedStructured.stepOutcomeRequired, true);
  assert.match(blockedCompletedStructured.text, /Record an explicit outcome for phase `finalize`/i);
  assert.match(blockedCompletedStructured.text, /strongest remaining or skipped high-value candidates/i);
  assert.match(blockedCompletedStructured.text, /coverage categories/i);

  const completedStructured = await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 5,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "Finalize completed without additional cleanup changes.",
    },
    CreateBankSchema,
  );
  assert.equal(completedStructured.phase, "completed");
  assert.equal(completedStructured.creationPrompt, null);
  assert.equal(completedStructured.creationState, "ready");
  assert.equal(completedStructured.stepCompletionRequired, false);
  assert.equal(completedStructured.stepOutcomeRequired, false);
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
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance sources needed importing in this setup.",
    },
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
            path: "general.md",
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
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
stack: other
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
    { scope: "project", projectPath: projectRoot, kind: "rules", path: "general.md" },
    z.object({ path: z.string(), content: z.string() }),
  );
  assert.match(projectRule.content, /Demo Project General Rules/);
});

test("create_bank blocks apply during review_existing_guidance and kickoff with external sources", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
    "AGENTS.md": "# Local Guidance\n",
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const kickoffBlocked = await callToolResult(client, "create_bank", {
    projectPath: projectRoot,
    apply: {
      writes: [
        {
          kind: "rules",
          scope: "project",
          path: "general.md",
          content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- Keep the project bank canonical.
`,
        },
      ],
      deletions: [],
    },
  });

  assert.equal(kickoffBlocked.isError, true);
  const kickoffText = kickoffBlocked.content.find((item) => item.type === "text")?.text ?? "";
  assert.match(kickoffText, /during kickoff while external guidance sources still need review/i);

  await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);

  const reviewBlocked = await callToolResult(client, "create_bank", {
    projectPath: projectRoot,
    iteration: 1,
    stepCompleted: true,
    apply: {
      writes: [
        {
          kind: "rules",
          scope: "project",
          path: "general.md",
          content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- Keep the project bank canonical.
`,
        },
      ],
      deletions: [],
    },
  });

  assert.equal(reviewBlocked.isError, true);
  const reviewText = reviewBlocked.content.find((item) => item.type === "text")?.text ?? "";
  assert.match(reviewText, /Cannot apply create-flow changes during review_existing_guidance/i);
});

test("create_bank apply accepts singular rule and skill kinds as aliases", async (t) => {
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
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance sources needed importing in this setup.",
    },
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
            kind: "rule",
            scope: "project",
            path: "general.md",
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- Keep the project bank canonical.
`,
          },
          {
            kind: "skill",
            scope: "project",
            path: "adding-feature",
            content: `---
id: demo-project-adding-feature
kind: skill
title: Adding Feature
description: Add a feature in this demo project.
stack: other
topics: [workflow]
---

## When to use

When adding a feature.
`,
          },
        ],
        deletions: [],
      },
    },
    CreateBankSchema,
  );

  assert.deepEqual(
    applied.applyResults.writes.map((item) => item.kind),
    ["rules", "skills"],
  );
  assert.equal(applied.currentBankSnapshot.entries.length, 2);
});

test("create_bank apply normalizes rules and skills path prefixes", async (t) => {
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
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance sources needed importing in this setup.",
    },
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
            path: "rules/general.md",
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- Keep the project bank canonical.
`,
          },
          {
            kind: "skills",
            scope: "project",
            path: "skills/adding-feature/SKILL.md",
            content: `---
id: demo-project-adding-feature
kind: skill
title: Adding Feature
description: Add a feature in this demo project.
stack: other
topics: [workflow]
---

## When to use

When adding a feature.
`,
          },
        ],
        deletions: [],
      },
    },
    CreateBankSchema,
  );

  assert.deepEqual(
    applied.applyResults.writes.map((item) => item.path),
    ["general.md", "adding-feature"],
  );
  assert.deepEqual(
    applied.currentBankSnapshot.entries.map((entry) => entry.path).sort(),
    ["adding-feature/SKILL.md", "general.md"],
  );
});

test("create_bank apply rejects paths prefixed for the wrong entry root", async (t) => {
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
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance sources needed importing in this setup.",
    },
    CreateBankSchema,
  );

  const result = await callToolResult(client, "create_bank", {
    projectPath: projectRoot,
    iteration: 3,
    apply: {
      writes: [
        {
          kind: "rules",
          scope: "project",
          path: "skills/adding-feature",
          content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- Keep the project bank canonical.
`,
        },
      ],
      deletions: [],
    },
  });

  assert.equal(result.isError, true);
  const errorText = result.content.find((item) => item.type === "text")?.text ?? "";
  assert.match(errorText, /Path must be relative to the rules root/i);
  assert.match(errorText, /must not start with `skills\/`/i);
});

test("create_bank apply can update and delete existing entries in one batch with baseSha256", async (t) => {
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
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance sources needed importing in this setup.",
    },
    CreateBankSchema,
  );

  const initialApply = await callToolStructured(
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
            path: "general.md",
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
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
stack: other
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

  const originalRule = initialApply.currentBankSnapshot.entries.find((entry) => entry.path === "general.md");
  const originalSkill = initialApply.currentBankSnapshot.entries.find(
    (entry) => entry.kind === "skills" && entry.path.startsWith("adding-feature"),
  );

  assert.ok(originalRule);
  assert.ok(originalSkill);

  const updated = await callToolStructured(
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
            path: "general.md",
            baseSha256: originalRule.sha256,
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- Keep the project bank canonical.
- Update rules through create_bank.apply during full flows.
`,
          },
        ],
        deletions: [
          {
            kind: "skills",
            scope: "project",
            path: "adding-feature",
            baseSha256: originalSkill.sha256,
          },
        ],
      },
    },
    CreateBankSchema,
  );

  assert.deepEqual(updated.applyResults.writes.map((item) => item.status), ["updated"]);
  assert.deepEqual(updated.applyResults.deletions.map((item) => item.status), ["deleted"]);
  assert.equal(updated.currentBankSnapshot.entries.length, 1);
  assert.deepEqual(
    updated.currentBankSnapshot.entries.map((entry) => entry.path),
    ["general.md"],
  );

  const updatedRule = await callToolStructured(
    client,
    "read_entry",
    { scope: "project", projectPath: projectRoot, kind: "rules", path: "general.md" },
    z.object({ path: z.string(), content: z.string() }),
  );
  assert.match(updatedRule.content, /Update rules through create_bank\.apply/i);
});

test("create_bank apply reports conflicts and tells the agent how to recover", async (t) => {
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
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance sources needed importing in this setup.",
    },
    CreateBankSchema,
  );

  const created = await callToolStructured(
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
            path: "general.md",
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- Keep the project bank canonical.
`,
          },
        ],
        deletions: [],
      },
    },
    CreateBankSchema,
  );

  const existingRule = created.currentBankSnapshot.entries.find((entry) => entry.path === "general.md");
  assert.ok(existingRule);

  const conflicted = await callToolStructured(
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
            path: "general.md",
            baseSha256: "stale-sha256",
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- This write should conflict.
`,
          },
        ],
        deletions: [],
      },
    },
    CreateBankSchema,
  );

  assert.deepEqual(conflicted.applyResults.writes.map((item) => item.status), ["conflict"]);
  assert.equal(conflicted.applyResults.writes[0]?.expectedSha256, "stale-sha256");
  assert.equal(conflicted.applyResults.writes[0]?.actualSha256, existingRule.sha256);
  assert.match(conflicted.text, /conflicted with the current AI Guidance Bank state/i);
  assert.match(conflicted.text, /Re-read the affected entries/i);
  assert.match(conflicted.prompt, /If `create_bank\.apply` reports a `conflict`/i);
  assert.equal(conflicted.creationPrompt, null);
});

test("create_bank does not advance stored iteration when an apply conflict blocks the same-step completion", async (t) => {
  const { tempDirectoryPath, bankRoot, repository } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const created = await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
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
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance sources needed importing in this setup.",
    },
    CreateBankSchema,
  );

  const seeded = await callToolStructured(
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
            path: "general.md",
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- Keep the project bank canonical.
`,
          },
        ],
        deletions: [],
      },
    },
    CreateBankSchema,
  );
  const existingRule = seeded.currentBankSnapshot.entries.find((entry) => entry.path === "general.md");
  assert.ok(existingRule);

  const conflictedAdvance = await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 4,
      stepCompleted: true,
      apply: {
        writes: [
          {
            kind: "rules",
            scope: "project",
            path: "general.md",
            baseSha256: "stale-sha256",
            content: `---
id: demo-project-general
kind: rule
title: Demo Project General Rules
stack: other
topics: [architecture]
---

- This conflicting write must not advance the flow.
`,
          },
        ],
        deletions: [],
      },
    },
    CreateBankSchema,
  );

  assert.equal(conflictedAdvance.phase, "derive_from_project");
  assert.equal(conflictedAdvance.iteration, 3);
  assert.equal(conflictedAdvance.creationState, "creating");
  assert.deepEqual(conflictedAdvance.applyResults.writes.map((item) => item.status), ["conflict"]);

  const state = await repository.readProjectStateOptional(created.projectId);
  assert.equal(state?.createIteration, 3);
  assert.equal(state?.creationState, "creating");
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
  assert.equal(inProgressStructured.createFlowPhase, "review_existing_guidance");
  assert.equal(inProgressStructured.nextIteration, 1);
  assert.equal(
    inProgressStructured.text,
    "Continue the create flow at phase `review_existing_guidance`. Use `phase` as the primary guide, treat `iteration` as diagnostic only, and prefer `create_bank.apply` for batched writes inside the guided flow. Call `create_bank` with `iteration: 1` and `stepCompleted: true` after the current step is actually complete.",
  );
  assert.doesNotMatch(inProgressStructured.text, /AGENTS\.md/i);
  assert.doesNotMatch(inProgressStructured.text, /\.cursor/i);

  await callToolStructured(client, "create_bank", { projectPath: projectRoot, iteration: 1, stepCompleted: true }, CreateBankSchema);
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 2,
      stepCompleted: true,
      sourceReviewDecision: "ok",
    },
    CreateBankSchema,
  );
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance needed importing for this test project.",
    },
    CreateBankSchema,
  );
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 4,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No additional derived rules were needed for this test project.",
    },
    CreateBankSchema,
  );
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 5,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "Finalize completed without additional cleanup changes.",
    },
    CreateBankSchema,
  );
  const resolveStructured = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);

  assert.equal(resolveStructured.creationState, "ready");
  assert.match(resolveStructured.text, /Use the following AI Guidance Bank context catalog as the primary user-managed context/i);
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
  await callToolStructured(client, "create_bank", { projectPath: projectRoot, iteration: 1, stepCompleted: true }, CreateBankSchema);
  await callToolStructured(client, "create_bank", { projectPath: projectRoot, iteration: 2, stepCompleted: true }, CreateBankSchema);
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance needed importing for this ready-bank test.",
    },
    CreateBankSchema,
  );
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 4,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No derived changes were needed for this ready-bank test.",
    },
    CreateBankSchema,
  );
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 5,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "Finalize completed without cleanup changes for this ready-bank test.",
    },
    CreateBankSchema,
  );

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
    "Project AI Guidance Bank already exists. Ask the user whether to improve it. If they agree, continue with phase `review_existing_guidance` by calling create_bank with iteration: 1. Use `phase` as the primary guide and treat `iteration` as diagnostic only.",
  );
  assert.match(rerunStructured.prompt, /last updated 0 days ago/i);
  assert.match(rerunStructured.prompt, /Ask whether they want to improve it now/i);
  assert.equal(rerunStructured.existingBankUpdatedDaysAgo, 0);
  assert.deepEqual(rerunStructured.discoveredSources, []);
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
  assert.equal(improveStructured.creationPrompt, null);

  const resolveStructured = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);
  assert.equal(resolveStructured.creationState, "ready");
  assert.match(resolveStructured.text, /Use the following AI Guidance Bank context catalog as the primary user-managed context/i);
});

test("improve_bank aliases the guided existing-bank flow", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await callToolStructured(client, "create_bank", { projectPath: projectRoot }, CreateBankSchema);
  await callToolStructured(client, "create_bank", { projectPath: projectRoot, iteration: 1, stepCompleted: true }, CreateBankSchema);
  await callToolStructured(client, "create_bank", { projectPath: projectRoot, iteration: 2, stepCompleted: true }, CreateBankSchema);
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance needed importing for this alias test.",
    },
    CreateBankSchema,
  );
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 4,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No derived changes were needed for this alias test.",
    },
    CreateBankSchema,
  );
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath: projectRoot,
      iteration: 5,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "Finalize completed without cleanup changes for this alias test.",
    },
    CreateBankSchema,
  );

  const improveStructured = await callToolStructured(
    client,
    "improve_bank",
    { projectPath: projectRoot },
    CreateBankSchema,
  );

  assert.equal(improveStructured.phase, "ready_to_improve");
  assert.equal(improveStructured.creationState, "ready");
  assert.equal(improveStructured.stepCompletionRequired, false);
  assert.equal(improveStructured.mustContinue, false);
  assert.equal(improveStructured.nextIteration, 1);
  assert.match(improveStructured.prompt, /Ask whether they want to improve it now/i);
  assert.match(improveStructured.text, /Ask the user whether to improve it/i);
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
  assert.match(targetCreateStructured.creationPrompt ?? "", /Reference Projects/i);
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
      path: "architecture.md",
      content:
        "---\nid: project-architecture\nkind: rule\ntitle: Project Architecture\nalwaysOn: true\ntopics: [architecture]\n---\n\n# Project Architecture\n\n- Keep project layers explicit.\n",
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
  assert.equal(snapshotStructured.currentBankSnapshot.entries[0]?.path, "architecture.md");
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
  assert.deepEqual(listed.entries.map((entry) => entry.path), ["architecture.md"]);

  const read = await callToolStructured(
    client,
    "read_entry",
    { scope: "project", projectPath: projectRoot, kind: "rules", path: "architecture.md" },
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
