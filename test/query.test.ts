import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { createProjectBankManifest, createProjectBankState } from "../src/core/bank/project.js";
import { CURRENT_STORAGE_VERSION } from "../src/core/bank/types.js";
import { resolveProjectIdentity } from "../src/core/projects/identity.js";
import { GuidanceBankQueryService } from "../src/query/index.js";
import { BankRepository } from "../src/storage/bankRepository.js";

const createQueryTestBank = async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-query-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const projectPath = path.join(tempDirectoryPath, "demo-project");
  const projectIdentity = resolveProjectIdentity(projectPath);
  const repository = new BankRepository(bankRoot);

  await repository.ensureStructure();
  await repository.ensureStarterFiles();
  await repository.writeManifest({
    schemaVersion: 1,
    storageVersion: CURRENT_STORAGE_VERSION,
    bankId: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-04-24T09:00:00.000Z",
    updatedAt: "2026-04-24T09:00:00.000Z",
    enabledProviders: ["codex", "cursor"],
    defaultMcpTransport: "stdio",
  });

  await repository.ensureProjectStructure(projectIdentity.projectId);
  await repository.writeProjectManifest(
    projectIdentity.projectId,
    createProjectBankManifest(projectIdentity.projectId, "Demo Project", projectPath, ["nodejs", "typescript"]),
  );
  await repository.writeProjectState(projectIdentity.projectId, createProjectBankState("ready"));

  await repository.upsertRule(
    "shared",
    "shared-rule.md",
    `---
id: shared-rule
kind: rule
title: Shared Rule
stack: nodejs
topics: [shared]
---

# Shared Rule

- Use the shared rule.
`,
  );

  await repository.upsertSkill(
    "project",
    "project-skill",
    `---
id: project-skill
kind: skill
title: Project Skill
name: project-skill
description: Project-specific skill.
stack: nodejs
topics: [project]
---

# Project Skill

1. Apply the project skill.
`,
    projectIdentity.projectId,
  );

  return { bankRoot, projectPath };
};

test("query service returns bootstrap with selected project summary", async () => {
  const { bankRoot, projectPath } = await createQueryTestBank();
  const service = new GuidanceBankQueryService(bankRoot);

  const bootstrap = await service.getBootstrap({ projectPath });

  assert.equal(bootstrap.bankRoot, bankRoot);
  assert.equal(bootstrap.manifest.storageVersion, CURRENT_STORAGE_VERSION);
  assert.equal(bootstrap.availableProjects.length, 1);
  assert.equal(bootstrap.selectedProject.status, "ready");
  assert.equal(bootstrap.selectedProject.projectPath, projectPath);
  assert.equal(bootstrap.selectedProject.entries.skills, 1);
});

test("query service lists and reads normalized entries", async () => {
  const { bankRoot, projectPath } = await createQueryTestBank();
  const service = new GuidanceBankQueryService(bankRoot);

  const sharedRules = await service.listEntries({
    scope: "shared",
    kind: "rules",
  });
  const projectSkills = await service.listEntries({
    scope: "project",
    kind: "skills",
    projectPath,
  });

  assert.equal(sharedRules.some((entry) => entry.path === "shared-rule.md"), true);
  assert.equal(projectSkills.some((entry) => entry.path === "project-skill"), true);

  const projectSkill = await service.readEntry({
    scope: "project",
    kind: "skills",
    projectPath,
    path: "project-skill/SKILL.md",
  });

  assert.equal(projectSkill.path, "project-skill");
  assert.equal(projectSkill.description, "Project-specific skill.");
  assert.match(projectSkill.body, /Apply the project skill/);
});

test("query service writes and rereads updated entries", async () => {
  const { bankRoot } = await createQueryTestBank();
  const service = new GuidanceBankQueryService(bankRoot);

  const result = await service.writeEntry({
    scope: "shared",
    kind: "rules",
    path: "shared-rule.md",
    content: `---
id: shared-rule
kind: rule
title: Shared Rule Updated
stack: nodejs
topics: [shared, updated]
---

# Shared Rule Updated

- Use the updated shared rule.
`,
  });

  assert.equal(result.status, "updated");
  assert.equal(result.entry.title, "Shared Rule Updated");
  assert.match(result.entry.body, /updated shared rule/);
  assert.deepEqual(result.entry.topics, ["shared", "updated"]);
});

test("query service writes and rereads skills through SKILL.md", async () => {
  const { bankRoot } = await createQueryTestBank();
  const service = new GuidanceBankQueryService(bankRoot);

  const result = await service.writeEntry({
    scope: "shared",
    kind: "skills",
    path: "new-skill",
    content: `---
id: new-skill
kind: skill
title: New Skill
name: new-skill
description: New shared skill.
stack: nodejs
topics: [shared, skills]
---

# New Skill

1. Apply the new shared skill.
`,
  });

  assert.equal(result.status, "created");
  assert.equal(result.entry.path, "new-skill");
  assert.equal(result.entry.filePath, "new-skill/SKILL.md");
  assert.equal(result.entry.description, "New shared skill.");
  assert.match(result.entry.body, /new shared skill/);
});
