import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { StatsService } from "../src/core/stats/statsService.js";
import { createProjectBankManifest, createProjectBankState } from "../src/core/bank/project.js";
import { BankRepository } from "../src/storage/bankRepository.js";
import { AuditLogger } from "../src/storage/auditLogger.js";

test("stats service returns overall bank overview and audit aggregates", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-stats-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const repository = new BankRepository(bankRoot);
  const auditLogger = new AuditLogger({ bankRoot, provider: "codex" });

  await repository.ensureStructure();
  await repository.ensureStarterFiles();
  await repository.writeManifest({
    schemaVersion: 1,
    storageVersion: 1,
    bankId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    enabledProviders: ["codex", "cursor"],
    defaultMcpTransport: "stdio",
  });

  await repository.ensureProjectStructure("project-1");
  await repository.writeProjectManifest(
    "project-1",
    createProjectBankManifest("project-1", "Demo Project", "/tmp/demo-project", ["nodejs", "typescript"]),
  );
  await repository.writeProjectState("project-1", createProjectBankState("ready"));
  await repository.upsertRule(
    "project",
    "demo.md",
    `---
id: demo-rule
kind: rule
title: Demo Rule
stack: nodejs
topics: [demo]
---

# Demo Rule

- Use the demo rule.
`,
    "project-1",
  );

  await auditLogger.writeEvent({
    sessionRef: "session-1",
    tool: "resolve_context",
    action: "resolve",
    projectId: "project-1",
    projectPath: "/tmp/demo-project",
    details: { creationState: "ready" },
  });
  await auditLogger.writeEvent({
    sessionRef: "session-1",
    tool: "set_project_state",
    action: "set_state",
    projectId: "project-1",
    projectPath: "/tmp/demo-project",
    details: { creationState: "ready" },
  });

  const stats = await new StatsService(bankRoot).collect();

  assert.equal(stats.bankRoot, bankRoot);
  assert.equal(stats.manifest.bankId, "11111111-1111-4111-8111-111111111111");
  assert.equal(stats.sharedEntries.rules > 0, true);
  assert.equal(stats.projects.total, 1);
  assert.equal(stats.projects.byCreationState.ready, 1);
  assert.equal(stats.audit.totalEvents, 2);
  assert.equal(stats.audit.byTool.resolve_context, 1);
  assert.equal(stats.audit.byTool.set_project_state, 1);
  assert.equal(stats.audit.byProvider.codex, 2);
  assert.equal(stats.audit.latestEvents.length, 2);
});

test("stats service returns project-focused overview when project path is provided", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-stats-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const repository = new BankRepository(bankRoot);
  const auditLogger = new AuditLogger({ bankRoot, provider: "claude-code" });

  await repository.ensureStructure();
  await repository.ensureStarterFiles();
  await repository.writeManifest({
    schemaVersion: 1,
    storageVersion: 1,
    bankId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z",
    enabledProviders: ["claude-code"],
    defaultMcpTransport: "stdio",
  });

  await repository.ensureProjectStructure("project-2");
  await repository.writeProjectManifest(
    "project-2",
    createProjectBankManifest("project-2", "Focus Project", "/tmp/focus-project", ["nodejs"]),
  );
  await repository.writeProjectState("project-2", createProjectBankState("postponed"));
  await repository.upsertSkill(
    "project",
    "focus-skill",
    `---
id: focus-skill
kind: skill
title: Focus Skill
name: focus-skill
description: Focus work.
stack: nodejs
topics: [focus]
---

# Focus Skill

1. Focus on the project.
`,
    "project-2",
  );

  await auditLogger.writeEvent({
    sessionRef: "session-2",
    tool: "create_bank",
    action: "create_flow",
    projectId: "project-2",
    projectPath: "/tmp/focus-project",
    details: { phase: "kickoff" },
  });

  const stats = await new StatsService(bankRoot).collect({
    projectPath: "/tmp/focus-project",
  });

  assert.equal(stats.project?.projectId, "project-2");
  assert.equal(stats.project?.creationState, "postponed");
  assert.equal(stats.project?.entries.rules, 0);
  assert.equal(stats.project?.entries.skills, 1);
  assert.equal(stats.project?.audit.totalEvents, 1);
  assert.equal(stats.project?.audit.byTool.create_bank, 1);
  assert.equal(stats.project?.audit.byProvider["claude-code"], 1);
  assert.equal(stats.project?.audit.latestEvents.length, 1);
});
