import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { z } from "zod";

import {
  callToolStructured,
  createConnectedClient,
  createInitializedBank,
  TextPayloadSchema,
  writeProjectFiles,
} from "./helpers/mcpTestUtils.js";

const EntryMutationSchema = z.object({
  status: z.enum(["created", "updated"]),
  scope: z.enum(["shared", "project"]),
  path: z.string(),
  filePath: z.string().optional(),
});

const DeleteEntrySchema = z.object({
  status: z.enum(["deleted", "not_found"]),
  path: z.string(),
});

const ClearProjectBankSchema = z.object({
  status: z.enum(["cleared", "not_found"]),
  projectId: z.string(),
  projectBankPath: z.string(),
});

const advanceCreateFlowToReady = async (client: Awaited<ReturnType<typeof createConnectedClient>>["client"], projectPath: string) => {
  await callToolStructured(client, "create_bank", { projectPath }, z.object({ projectId: z.string() }));
  await callToolStructured(client, "create_bank", { projectPath, iteration: 1, stepCompleted: true }, z.object({ projectId: z.string() }));
  await callToolStructured(client, "create_bank", { projectPath, iteration: 2, stepCompleted: true }, z.object({ projectId: z.string() }));
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath,
      iteration: 3,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No external guidance needed importing in this setup.",
    },
    z.object({ projectId: z.string() }),
  );
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath,
      iteration: 4,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "No derived changes were needed in this setup.",
    },
    z.object({ projectId: z.string() }),
  );
  await callToolStructured(
    client,
    "create_bank",
    {
      projectPath,
      iteration: 5,
      stepCompleted: true,
      stepOutcome: "no_changes",
      stepOutcomeNote: "Finalize completed without cleanup changes in this setup.",
    },
    z.object({ projectId: z.string() }),
  );
};

const setupAngularProject = async () => {
  const { tempDirectoryPath, bankRoot } = await createInitializedBank();
  const projectRoot = path.join(tempDirectoryPath, "angular-admin");

  await writeProjectFiles(projectRoot, {
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

  const { client, close } = await createConnectedClient(bankRoot, { provider: "cursor" });
  await advanceCreateFlowToReady(client, projectRoot);

  return { projectRoot, bankRoot, client, close };
};

test("upsert tools write shared and project entries that resolve_context exposes", async (t) => {
  const { projectRoot, client, close } = await setupAngularProject();
  t.after(close);

  const sharedRule = await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "shared",
      projectPath: projectRoot,
      path: "angular-architecture.md",
      content:
        "---\nid: shared-angular-architecture\nkind: rule\ntitle: Angular Architecture\nstack: angular\ntopics: [architecture]\n---\n\n# Angular Architecture\n\n- Keep route containers thin.\n",
    },
    EntryMutationSchema,
  );
  assert.equal(sharedRule.scope, "shared");

  const projectRule = await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "project",
      projectPath: projectRoot,
      path: "admin-dashboard.md",
      content:
        "---\nid: project-admin-dashboard\nkind: rule\ntitle: Admin Dashboard\nstack: angular\ntopics: [dashboard]\n---\n\n# Admin Dashboard\n\n- Prefer existing feature containers over new top-level modules.\n",
    },
    EntryMutationSchema,
  );
  assert.equal(projectRule.scope, "project");

  const sharedSkill = await callToolStructured(
    client,
    "upsert_skill",
    {
      scope: "shared",
      projectPath: projectRoot,
      path: "component-audit",
      content:
        "---\nid: shared-component-audit\nkind: skill\ntitle: Component Audit\nname: component-audit\ndescription: Review Angular components before editing.\nstack: angular\ntopics: [components]\n---\n\n# Component Audit\n\n1. Check inputs and outputs.\n",
    },
    EntryMutationSchema,
  );
  assert.equal(sharedSkill.filePath, "component-audit/SKILL.md");

  const projectSkill = await callToolStructured(
    client,
    "upsert_skill",
    {
      scope: "project",
      projectPath: projectRoot,
      path: "adding-admin-widget",
      content:
        "---\nid: project-adding-admin-widget\nkind: skill\ntitle: Adding Admin Widget\nname: adding-admin-widget\ndescription: Add a new admin widget in this repository.\nstack: angular\ntopics: [widgets]\n---\n\n# Adding Admin Widget\n\n1. Start from the existing dashboard feature shell.\n",
    },
    EntryMutationSchema,
  );
  assert.equal(projectSkill.scope, "project");

  const resolved = await callToolStructured(
    client,
    "resolve_context",
    { projectPath: projectRoot },
    z.object({
      text: z.string(),
      rulesCatalog: z
        .array(
          z.object({
            scope: z.enum(["shared", "project"]),
            kind: z.literal("rules"),
            path: z.string(),
            title: z.string(),
            topics: z.array(z.string()),
            description: z.string().nullable().optional(),
          }),
        )
        .optional(),
      skillsCatalog: z
        .array(
          z.object({
            scope: z.enum(["shared", "project"]),
            kind: z.literal("skills"),
            path: z.string(),
            title: z.string(),
            topics: z.array(z.string()),
            description: z.string().nullable().optional(),
          }),
        )
        .optional(),
    }),
  );

  assert.match(resolved.text, /Catalog Summary/);
  assert.match(resolved.text, /- Rules: \d+ entries\./i);
  assert.match(resolved.text, /- Skills: \d+ entries\./i);
  assert.equal(resolved.rulesCatalog?.some((entry) => entry.path === "angular-architecture.md"), true);
  assert.equal(resolved.rulesCatalog?.some((entry) => entry.path === "admin-dashboard.md"), true);
  assert.equal(resolved.skillsCatalog?.some((entry) => entry.path === "component-audit/SKILL.md"), true);
  assert.equal(resolved.skillsCatalog?.some((entry) => entry.path === "adding-admin-widget/SKILL.md"), true);
});

test("resolve_context returns skill paths exactly as stored and read_entry accepts those paths", async (t) => {
  const { projectRoot, client, close } = await setupAngularProject();
  t.after(close);

  await callToolStructured(
    client,
    "upsert_skill",
    {
      scope: "shared",
      projectPath: projectRoot,
      path: "task-based-reading",
      content:
        "---\nid: shared-task-based-reading\nkind: skill\ntitle: Task Based Reading\nname: task-based-reading\ndescription: Read the repo by task.\nstack: angular\ntopics: [reading]\n---\n\n# Task Based Reading\n\n1. Start from the route entrypoint.\n",
    },
    EntryMutationSchema,
  );

  await callToolStructured(
    client,
    "upsert_skill",
    {
      scope: "project",
      projectPath: projectRoot,
      path: "angular-components",
      content:
        "---\nid: project-angular-components\nkind: skill\ntitle: Angular Components\nname: angular-components\ndescription: Project-specific Angular component rules.\nstack: angular\ntopics: [components]\n---\n\n# Angular Components\n\n1. Follow the existing component style in this project.\n",
    },
    EntryMutationSchema,
  );

  const resolved = await callToolStructured(
    client,
    "resolve_context",
    { projectPath: projectRoot },
    z.object({
      skillsCatalog: z
        .array(
          z.object({
            scope: z.enum(["shared", "project"]),
            kind: z.literal("skills"),
            path: z.string(),
            title: z.string(),
            topics: z.array(z.string()),
            description: z.string().nullable().optional(),
          }),
        )
        .optional(),
    }),
  );

  assert.equal(resolved.skillsCatalog?.some((entry) => entry.path === "task-based-reading/SKILL.md"), true);
  assert.equal(resolved.skillsCatalog?.some((entry) => entry.path === "angular-components/SKILL.md"), true);

  const sharedSkill = await callToolStructured(
    client,
    "read_entry",
    { scope: "shared", kind: "skills", projectPath: projectRoot, path: "task-based-reading/SKILL.md" },
    z.object({ path: z.string(), content: z.string() }),
  );
  assert.match(sharedSkill.content, /Task Based Reading/);

  const projectSkill = await callToolStructured(
    client,
    "read_entry",
    { scope: "project", kind: "skills", projectPath: projectRoot, path: "angular-components/SKILL.md" },
    z.object({ path: z.string(), content: z.string() }),
  );
  assert.match(projectSkill.content, /Angular Components/);
});

test("delete_entry removes previously written entries", async (t) => {
  const { projectRoot, client, close } = await setupAngularProject();
  t.after(close);

  await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "project",
      projectPath: projectRoot,
      path: "admin-dashboard.md",
      content:
        "---\nid: project-admin-dashboard\nkind: rule\ntitle: Admin Dashboard\nstack: angular\ntopics: [dashboard]\n---\n\n# Admin Dashboard\n\n- Prefer existing feature containers over new top-level modules.\n",
    },
    EntryMutationSchema,
  );
  await callToolStructured(
    client,
    "upsert_skill",
    {
      scope: "shared",
      projectPath: projectRoot,
      path: "component-audit",
      content:
        "---\nid: shared-component-audit\nkind: skill\ntitle: Component Audit\nname: component-audit\ndescription: Review Angular components before editing.\nstack: angular\ntopics: [components]\n---\n\n# Component Audit\n\n1. Check inputs and outputs.\n",
    },
    EntryMutationSchema,
  );

  const deletedRule = await callToolStructured(
    client,
    "delete_entry",
    { scope: "project", kind: "rules", projectPath: projectRoot, path: "admin-dashboard.md" },
    DeleteEntrySchema,
  );
  assert.equal(deletedRule.status, "deleted");

  const deletedSkill = await callToolStructured(
    client,
    "delete_entry",
    { scope: "shared", kind: "skills", projectPath: projectRoot, path: "component-audit" },
    DeleteEntrySchema,
  );
  assert.equal(deletedSkill.status, "deleted");

  const resolved = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);
  assert.doesNotMatch(resolved.text, /### project\/admin-dashboard\.md/);
  assert.doesNotMatch(resolved.text, /### shared\/component-audit\/SKILL\.md/);
});

test("clear_project_bank removes only the current project bank and allows recreate from scratch", async (t) => {
  const { projectRoot, client, close } = await setupAngularProject();
  t.after(close);

  await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "shared",
      projectPath: projectRoot,
      path: "angular-architecture.md",
      content:
        "---\nid: shared-angular-architecture\nkind: rule\ntitle: Angular Architecture\nstack: angular\ntopics: [architecture]\n---\n\n# Angular Architecture\n\n- Keep route containers thin.\n",
    },
    EntryMutationSchema,
  );
  await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "project",
      projectPath: projectRoot,
      path: "admin-dashboard.md",
      content:
        "---\nid: project-admin-dashboard\nkind: rule\ntitle: Admin Dashboard\nstack: angular\ntopics: [dashboard]\n---\n\n# Admin Dashboard\n\n- Prefer existing feature containers over new top-level modules.\n",
    },
    EntryMutationSchema,
  );

  const cleared = await callToolStructured(
    client,
    "clear_project_bank",
    { projectPath: projectRoot },
    ClearProjectBankSchema,
  );
  assert.equal(cleared.status, "cleared");

  const resolvedAfterClear = await callToolStructured(
    client,
    "resolve_context",
    { projectPath: projectRoot },
    TextPayloadSchema,
  );
  assert.equal(resolvedAfterClear.creationState, "unknown");
  assert.match(resolvedAfterClear.text, /No project AI Guidance Bank exists for this repository/i);

  const sharedRule = await callToolStructured(
    client,
    "read_entry",
    { kind: "rules", path: "angular-architecture.md" },
    z.object({ path: z.string(), content: z.string() }),
  );
  assert.match(sharedRule.content, /Keep route containers thin\./);

  const recreated = await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot },
    z.object({ status: z.enum(["created", "already_exists"]) }),
  );
  assert.equal(recreated.status, "created");
});

test("project entries override shared entries by canonical id instead of path", async (t) => {
  const { projectRoot, client, close } = await setupAngularProject();
  t.after(close);

  await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "shared",
      projectPath: projectRoot,
      path: "angular-architecture.md",
      content:
        "---\nid: architecture-boundaries\nkind: rule\ntitle: Architecture Boundaries\nstack: angular\ntopics: [architecture]\n---\n\n# Architecture Boundaries\n\n- Shared baseline architecture rule.\n",
    },
    EntryMutationSchema,
  );
  await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "project",
      projectPath: projectRoot,
      path: "admin-architecture.md",
      content:
        "---\nid: architecture-boundaries\nkind: rule\ntitle: Architecture Boundaries\nstack: angular\ntopics: [architecture]\n---\n\n# Architecture Boundaries\n\n- Project-specific architecture override.\n",
    },
    EntryMutationSchema,
  );

  const resolved = await callToolStructured(
    client,
    "resolve_context",
    { projectPath: projectRoot },
    z.object({
      text: z.string(),
      rulesCatalog: z
        .array(
          z.object({
            scope: z.enum(["shared", "project"]),
            kind: z.literal("rules"),
            path: z.string(),
            title: z.string(),
            topics: z.array(z.string()),
            description: z.string().nullable().optional(),
          }),
        )
        .optional(),
    }),
  );
  const architectureEntries =
    resolved.rulesCatalog?.filter((entry) => entry.path === "admin-architecture.md") ?? [];
  assert.equal(architectureEntries.length, 1);
  assert.equal(architectureEntries[0]?.scope, "project");
  assert.match(architectureEntries[0]?.description ?? "", /Project-specific architecture override\./);
  assert.doesNotMatch(resolved.text, /Shared baseline architecture rule\./);
});

test("entry mutations append audit events with provider and sessionRef metadata", async (t) => {
  const { projectRoot, bankRoot, client, close } = await setupAngularProject();
  t.after(close);

  await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "shared",
      projectPath: projectRoot,
      sessionRef: "cursor:thread-123",
      path: "angular-architecture.md",
      content:
        "---\nid: shared-angular-architecture\nkind: rule\ntitle: Angular Architecture\nstack: angular\ntopics: [architecture]\n---\n\n# Angular Architecture\n\n- Keep route containers thin.\n",
    },
    EntryMutationSchema,
  );
  await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "shared",
      projectPath: projectRoot,
      sessionRef: "cursor:thread-123",
      path: "angular-architecture.md",
      content:
        "---\nid: shared-angular-architecture\nkind: rule\ntitle: Angular Architecture\nstack: angular\ntopics: [architecture]\n---\n\n# Angular Architecture\n\n- Keep route containers thin.\n- Keep reusable layout rules centralized.\n",
    },
    EntryMutationSchema,
  );
  await callToolStructured(
    client,
    "delete_entry",
    {
      scope: "shared",
      kind: "rules",
      projectPath: projectRoot,
      sessionRef: "cursor:thread-123",
      path: "angular-architecture.md",
    },
    DeleteEntrySchema,
  );

  const auditLogContent = await readFile(path.join(bankRoot, "audit", "events.ndjson"), "utf8");
  const events = auditLogContent
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.sessionRef === "cursor:thread-123");

  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((event) => event.tool),
    ["upsert_rule", "upsert_rule", "delete_entry"],
  );
  assert.deepEqual(
    events.map((event) => event.provider),
    ["cursor", "cursor", "cursor"],
  );
  assert.deepEqual(
    events.map((event) => event.sessionRef),
    ["cursor:thread-123", "cursor:thread-123", "cursor:thread-123"],
  );
  assert.equal(events[0]?.path, "angular-architecture.md");
  assert.ok(typeof events[0]?.deltaChars === "number" && (events[0].deltaChars as number) > 0);
  assert.ok(typeof events[1]?.deltaChars === "number" && (events[1].deltaChars as number) > 0);
  assert.ok(typeof events[2]?.deltaChars === "number" && (events[2].deltaChars as number) < 0);
  assert.equal((events[0]?.before as { exists?: boolean })?.exists, false);
  assert.equal((events[1]?.before as { entryId?: string | null })?.entryId, "shared-angular-architecture");
  assert.equal((events[2]?.after as { exists?: boolean })?.exists, false);

  const historyContent = await readFile(path.join(bankRoot, "history", "entry-events.ndjson"), "utf8");
  const historyEvents = historyContent
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.sessionRef === "cursor:thread-123");

  assert.equal(historyEvents.length, 3);
  assert.deepEqual(
    historyEvents.map((event) => event.auditEventId),
    events.map((event) => event.eventId),
  );
  assert.equal(historyEvents[0]?.beforeContent, null);
  assert.match(historyEvents[0]?.afterContent as string, /Keep route containers thin/i);
  assert.match(historyEvents[1]?.beforeContent as string, /Keep route containers thin/i);
  assert.match(historyEvents[1]?.afterContent as string, /Keep reusable layout rules centralized/i);
  assert.match(historyEvents[1]?.unifiedDiff as string, /\+- Keep reusable layout rules centralized/i);
  assert.match(historyEvents[2]?.beforeContent as string, /Keep reusable layout rules centralized/i);
  assert.equal(historyEvents[2]?.afterContent, null);
  assert.match(historyEvents[2]?.unifiedDiff as string, /-- Keep reusable layout rules centralized/i);
});

test("skill audit snapshots resolve existing entries when the tool path ends with skill.md in any case", async (t) => {
  const { projectRoot, bankRoot, client, close } = await setupAngularProject();
  t.after(close);

  await callToolStructured(
    client,
    "upsert_skill",
    {
      scope: "shared",
      projectPath: projectRoot,
      sessionRef: "cursor:thread-skill-audit",
      path: "component-audit/skill.md",
      content:
        "---\nid: shared-component-audit\nkind: skill\ntitle: Component Audit\nname: component-audit\ndescription: Review Angular components before editing.\nstack: angular\ntopics: [components]\n---\n\n# Component Audit\n\n1. Check inputs and outputs.\n",
    },
    EntryMutationSchema,
  );
  await callToolStructured(
    client,
    "upsert_skill",
    {
      scope: "shared",
      projectPath: projectRoot,
      sessionRef: "cursor:thread-skill-audit",
      path: "component-audit/Skill.md",
      content:
        "---\nid: shared-component-audit\nkind: skill\ntitle: Component Audit\nname: component-audit\ndescription: Review Angular components before editing.\nstack: angular\ntopics: [components]\n---\n\n# Component Audit\n\n1. Check inputs and outputs.\n2. Check template dependencies.\n",
    },
    EntryMutationSchema,
  );
  await callToolStructured(
    client,
    "delete_entry",
    {
      scope: "shared",
      kind: "skills",
      projectPath: projectRoot,
      sessionRef: "cursor:thread-skill-audit",
      path: "component-audit/skill.md",
    },
    DeleteEntrySchema,
  );

  const events = (await readFile(path.join(bankRoot, "audit", "events.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.sessionRef === "cursor:thread-skill-audit");

  assert.equal(events.length, 3);
  assert.equal((events[0]?.before as { exists?: boolean })?.exists, false);
  assert.equal((events[1]?.before as { exists?: boolean })?.exists, true);
  assert.equal((events[1]?.before as { entryId?: string | null })?.entryId, "shared-component-audit");
  assert.equal((events[2]?.before as { exists?: boolean })?.exists, true);
  assert.equal((events[2]?.after as { exists?: boolean })?.exists, false);
});
