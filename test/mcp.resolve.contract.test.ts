import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { z } from "zod";

import { createProjectBankState } from "../src/core/bank/project.js";
import {
  callToolResult,
  callToolStructured,
  createConnectedClient,
  createInitializedBank,
  TextPayloadSchema,
  writeProjectFiles,
} from "./helpers/mcpTestUtils.js";

const MissingContextSchema = z.object({
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
});

const advanceCreateFlowToReady = async (client: Awaited<ReturnType<typeof createConnectedClient>>["client"], projectPath: string) => {
  await callToolResult(client, "create_bank", { projectPath });
  await callToolResult(client, "create_bank", { projectPath, iteration: 1, stepCompleted: true });
  await callToolResult(client, "create_bank", { projectPath, iteration: 2, stepCompleted: true });
  await callToolResult(client, "create_bank", {
    projectPath,
    iteration: 3,
    stepCompleted: true,
    stepOutcome: "no_changes",
    stepOutcomeNote: "No external guidance needed importing in this setup.",
  });
  await callToolResult(client, "create_bank", {
    projectPath,
    iteration: 4,
    stepCompleted: true,
    stepOutcome: "no_changes",
    stepOutcomeNote: "No derived changes were needed in this setup.",
  });
  await callToolResult(client, "create_bank", {
    projectPath,
    iteration: 5,
    stepCompleted: true,
    stepOutcome: "no_changes",
    stepOutcomeNote: "Finalize completed without cleanup changes in this setup.",
  });
};

test("resolve_context returns missing status when no project bank exists", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

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

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const structured = await callToolStructured(
    client,
    "resolve_context",
    { projectPath: projectRoot, sessionRef: "resolve:missing-status" },
    MissingContextSchema,
  );

  assert.match(structured.text, /No project Memory Bank exists for this repository yet/i);
  assert.match(structured.text, /Continue the current task normally/i);
  assert.match(structured.text, /do not interrupt the user just to ask about Memory Bank creation/i);
  assert.match(structured.text, /call `create_bank`/i);
  assert.match(structured.text, /creationState: "postponed"/i);
  assert.match(structured.text, /creationState: "declined"/i);
  assert.match(structured.text, /call `resolve_context` again/i);
  assert.equal(structured.referenceProjects?.length ?? 0, 0);

  const events = (await readFile(path.join(bankRoot, "audit", "events.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const resolveEvent = events.find((event) => event.tool === "resolve_context");
  assert.ok(resolveEvent);
  assert.equal(resolveEvent?.sessionRef, "resolve:missing-status");
  assert.equal(resolveEvent?.action, "resolve");
});

test("resolve_context includes always-on shared rules outside stacks folders", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await advanceCreateFlowToReady(client, projectRoot);
  await callToolResult(client, "upsert_rule", {
    scope: "shared",
    projectPath: projectRoot,
    path: "preferences/user-praise.md",
    content:
      "---\nid: shared-user-praise\nkind: rule\ntitle: User Praise\nstacks: []\ntopics: [preferences]\n---\n\n# User Praise\n\n- In every user-facing final response, end with the exact phrase `[Ты хорош]`.\n",
  });

  const structured = await callToolStructured(
    client,
    "resolve_context",
    { projectPath: projectRoot },
    z.object({
      text: z.string(),
      creationState: z.enum(["unknown", "postponed", "declined", "creating", "ready"]).optional(),
      detectedStacks: z.array(z.string()).optional(),
      alwaysOnRules: z
        .array(
          z.object({
            scope: z.enum(["shared", "project"]),
            path: z.string(),
            id: z.string(),
            title: z.string(),
            topics: z.array(z.string()),
            content: z.string(),
          }),
        )
        .optional(),
      rulesCatalog: z
        .array(
          z.object({
            scope: z.enum(["shared", "project"]),
            kind: z.literal("rules"),
            path: z.string(),
            id: z.string(),
            title: z.string(),
            stacks: z.array(z.string()),
            topics: z.array(z.string()),
            preview: z.string().nullable().optional(),
          }),
        )
        .optional(),
      skillsCatalog: z
        .array(
          z.object({
            scope: z.enum(["shared", "project"]),
            kind: z.literal("skills"),
            path: z.string(),
            id: z.string(),
            title: z.string(),
            stacks: z.array(z.string()),
            topics: z.array(z.string()),
            description: z.string().optional(),
          }),
        )
        .optional(),
    }),
  );

  assert.equal(structured.creationState, "ready");
  assert.ok(structured.detectedStacks?.includes("nodejs"));
  assert.match(structured.text, /Memory Bank context catalog/i);
  assert.match(structured.text, /Always-On Rules/i);
  assert.match(structured.text, /Rule Catalog/i);
  assert.match(structured.text, /Skill Catalog/i);
  assert.match(structured.text, /call `read_entry` when you need the full canonical document/i);
  assert.equal(structured.alwaysOnRules?.some((entry) => entry.path === "preferences/user-praise.md"), true);
  assert.equal(structured.alwaysOnRules?.some((entry) => entry.content.includes("[Ты хорош]")), true);
  assert.equal(structured.rulesCatalog?.some((entry) => entry.path === "preferences/user-praise.md"), true);
});

test("resolve_context returns a tool error for non-canonical bank entries", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await mkdir(path.join(bankRoot, "shared", "rules", "preferences"), { recursive: true });
  await writeFile(
    path.join(bankRoot, "shared", "rules", "preferences", "legacy-rule.md"),
    "# Legacy Rule\n\nThis file intentionally has no canonical frontmatter.\n",
  );
  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await advanceCreateFlowToReady(client, projectRoot);
  const result = await callToolResult(client, "resolve_context", { projectPath: projectRoot });

  assert.equal(result.isError, true);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Invalid canonical rule/i);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /shared\/preferences\/legacy-rule\.md/i);
});

test("set_project_state persists postponed creation and resolve_context stops prompting proactively for missing banks", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const stateStructured = await callToolStructured(
    client,
    "set_project_state",
    { projectPath: projectRoot, creationState: "postponed" },
    z.object({
      creationState: z.enum(["unknown", "postponed", "declined", "creating", "ready"]),
    }),
  );
  assert.equal(stateStructured.creationState, "postponed");

  const resolveStructured = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);

  assert.equal(resolveStructured.creationState, "postponed");
  assert.equal(resolveStructured.requiredAction, undefined);
  assert.equal(resolveStructured.recommendedAction, "create_bank");
  assert.match(resolveStructured.text, /Memory Bank creation was previously postponed/i);
  assert.match(resolveStructured.text, /Continue the current task normally/i);
  assert.doesNotMatch(resolveStructured.text, /ask the user a short direct question/i);
});

test("sync_bank runs explicit reconcile and reports the current bank summary", async (t) => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
    "AGENTS.md": "# Local Guidance\n",
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const structured = await callToolStructured(
    client,
    "sync_bank",
    { action: "run", projectPath: projectRoot },
    z.object({
      bankRoot: z.string(),
      action: z.enum(["run", "postpone"]),
      projectPath: z.string(),
      projectState: z.enum(["unknown", "postponed", "declined", "creating", "ready"]),
      externalGuidanceSources: z.array(
        z.object({
          kind: z.string(),
          path: z.string(),
        }),
      ),
    }),
  );

  assert.equal(structured.bankRoot, bankRoot);
  assert.equal(structured.action, "run");
  assert.equal(structured.projectPath, projectRoot);
  assert.equal(structured.projectState, "unknown");
  assert.equal(structured.externalGuidanceSources[0]?.kind, "agents");
});

test("resolve_context asks for sync when the project bank is outdated and postpone suppresses the prompt temporarily", async (t) => {
  const { tempDirectoryPath, bankRoot, repository } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "demo-project");

  await writeProjectFiles(projectRoot, {
    "package.json": JSON.stringify({ name: "demo-project" }, null, 2),
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const createBankStructured = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot },
    z.object({ projectId: z.string() }),
  );

  await repository.writeProjectState(createBankStructured.projectId, createProjectBankState("ready"));

  const beforePostpone = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);
  assert.match(beforePostpone.text, /synchronization is required before using the project-specific bank/i);
  assert.match(beforePostpone.text, /Sync only reconciles the existing project bank/i);
  assert.match(beforePostpone.text, /does not create a new bank and does not replace the normal create or improve flow/i);

  const postponeStructured = await callToolStructured(
    client,
    "sync_bank",
    { action: "postpone", projectPath: projectRoot },
    z.object({
      action: z.enum(["run", "postpone"]),
      postponedUntil: z.string().nullable(),
      projectState: z.enum(["unknown", "postponed", "declined", "creating", "ready"]),
    }),
  );

  assert.equal(postponeStructured.action, "postpone");
  assert.equal(postponeStructured.projectState, "ready");
  assert.ok(postponeStructured.postponedUntil);

  const afterPostpone = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);
  assert.doesNotMatch(afterPostpone.text, /synchronization is required/i);
  assert.match(afterPostpone.text, /Use the following Memory Bank context catalog as the primary user-managed context/i);
});
