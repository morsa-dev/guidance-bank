import assert from "node:assert/strict";
import path from "node:path";
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

  const { client, close } = await createConnectedClient(bankRoot);
  await callToolStructured(
    client,
    "create_bank",
    { projectPath: projectRoot },
    z.object({ projectId: z.string() }),
  );

  return { projectRoot, client, close };
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
      path: "topics/angular-architecture.md",
      content:
        "---\nid: shared-angular-architecture\nkind: rule\ntitle: Angular Architecture\nstacks: [angular]\ntopics: [architecture]\n---\n\n# Angular Architecture\n\n- Keep route containers thin.\n",
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
      path: "topics/admin-dashboard.md",
      content:
        "---\nid: project-admin-dashboard\nkind: rule\ntitle: Admin Dashboard\nstacks: [angular]\ntopics: [dashboard]\n---\n\n# Admin Dashboard\n\n- Prefer existing feature containers over new top-level modules.\n",
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
      path: "stacks/angular/component-audit",
      content:
        "---\nid: shared-component-audit\nkind: skill\ntitle: Component Audit\nname: component-audit\ndescription: Review Angular components before editing.\nstacks: [angular]\ntopics: [components]\n---\n\n# Component Audit\n\n1. Check inputs and outputs.\n",
    },
    EntryMutationSchema,
  );
  assert.equal(sharedSkill.filePath, "stacks/angular/component-audit/SKILL.md");

  const projectSkill = await callToolStructured(
    client,
    "upsert_skill",
    {
      scope: "project",
      projectPath: projectRoot,
      path: "stacks/angular/adding-admin-widget",
      content:
        "---\nid: project-adding-admin-widget\nkind: skill\ntitle: Adding Admin Widget\nname: adding-admin-widget\ndescription: Add a new admin widget in this repository.\nstacks: [angular]\ntopics: [widgets]\n---\n\n# Adding Admin Widget\n\n1. Start from the existing dashboard feature shell.\n",
    },
    EntryMutationSchema,
  );
  assert.equal(projectSkill.scope, "project");

  const resolved = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);

  assert.match(resolved.text, /### shared\/topics\/angular-architecture\.md/);
  assert.match(resolved.text, /### project\/topics\/admin-dashboard\.md/);
  assert.match(resolved.text, /### shared\/stacks\/angular\/component-audit\/SKILL\.md/);
  assert.match(resolved.text, /### project\/stacks\/angular\/adding-admin-widget\/SKILL\.md/);
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
      path: "topics/admin-dashboard.md",
      content:
        "---\nid: project-admin-dashboard\nkind: rule\ntitle: Admin Dashboard\nstacks: [angular]\ntopics: [dashboard]\n---\n\n# Admin Dashboard\n\n- Prefer existing feature containers over new top-level modules.\n",
    },
    EntryMutationSchema,
  );
  await callToolStructured(
    client,
    "upsert_skill",
    {
      scope: "shared",
      projectPath: projectRoot,
      path: "stacks/angular/component-audit",
      content:
        "---\nid: shared-component-audit\nkind: skill\ntitle: Component Audit\nname: component-audit\ndescription: Review Angular components before editing.\nstacks: [angular]\ntopics: [components]\n---\n\n# Component Audit\n\n1. Check inputs and outputs.\n",
    },
    EntryMutationSchema,
  );

  const deletedRule = await callToolStructured(
    client,
    "delete_entry",
    { scope: "project", kind: "rules", projectPath: projectRoot, path: "topics/admin-dashboard.md" },
    DeleteEntrySchema,
  );
  assert.equal(deletedRule.status, "deleted");

  const deletedSkill = await callToolStructured(
    client,
    "delete_entry",
    { scope: "shared", kind: "skills", projectPath: projectRoot, path: "stacks/angular/component-audit" },
    DeleteEntrySchema,
  );
  assert.equal(deletedSkill.status, "deleted");

  const resolved = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);
  assert.doesNotMatch(resolved.text, /### project\/topics\/admin-dashboard\.md/);
  assert.doesNotMatch(resolved.text, /### shared\/stacks\/angular\/component-audit\/SKILL\.md/);
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
      path: "topics/angular-architecture.md",
      content:
        "---\nid: architecture-boundaries\nkind: rule\ntitle: Architecture Boundaries\nstacks: [angular]\ntopics: [architecture]\n---\n\n# Architecture Boundaries\n\n- Shared baseline architecture rule.\n",
    },
    EntryMutationSchema,
  );
  await callToolStructured(
    client,
    "upsert_rule",
    {
      scope: "project",
      projectPath: projectRoot,
      path: "topics/admin-architecture.md",
      content:
        "---\nid: architecture-boundaries\nkind: rule\ntitle: Architecture Boundaries\nstacks: [angular]\ntopics: [architecture]\n---\n\n# Architecture Boundaries\n\n- Project-specific architecture override.\n",
    },
    EntryMutationSchema,
  );

  const resolved = await callToolStructured(client, "resolve_context", { projectPath: projectRoot }, TextPayloadSchema);
  assert.match(resolved.text, /Project-specific architecture override\./);
  assert.doesNotMatch(resolved.text, /Shared baseline architecture rule\./);
});
