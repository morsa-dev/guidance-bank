import assert from "node:assert/strict";
import test from "node:test";

import {
  getProjectBankContinuationIteration,
  isProjectBankSyncPostponed,
  requiresProjectBankSync,
  resolveProjectBankLifecycleStatus,
} from "../src/core/bank/lifecycle.js";
import { createProjectBankManifest, createProjectBankState } from "../src/core/bank/project.js";

test("project bank lifecycle resolves missing declined creating sync_required and ready states", () => {
  const projectManifest = createProjectBankManifest("demo", "Demo", "/tmp/demo", [], new Date("2026-04-01T00:00:00.000Z"));

  assert.equal(
    resolveProjectBankLifecycleStatus({
      projectManifest: null,
      projectState: null,
      expectedStorageVersion: 1,
    }),
    "missing",
  );

  assert.equal(
    resolveProjectBankLifecycleStatus({
      projectManifest,
      projectState: createProjectBankState("declined"),
      expectedStorageVersion: 1,
    }),
    "creation_declined",
  );

  assert.equal(
    resolveProjectBankLifecycleStatus({
      projectManifest,
      projectState: createProjectBankState("creating", { createIteration: 2 }),
      expectedStorageVersion: 1,
    }),
    "creation_in_progress",
  );

  assert.equal(
    resolveProjectBankLifecycleStatus({
      projectManifest,
      projectState: createProjectBankState("ready", { lastSyncedStorageVersion: null }),
      expectedStorageVersion: 1,
    }),
    "sync_required",
  );

  assert.equal(
    resolveProjectBankLifecycleStatus({
      projectManifest,
      projectState: createProjectBankState("ready", { lastSyncedStorageVersion: 1 }),
      expectedStorageVersion: 1,
    }),
    "ready",
  );
});

test("project bank lifecycle helpers preserve current sync and iteration semantics", () => {
  const now = new Date("2026-04-03T12:00:00.000Z");
  const postponedState = createProjectBankState("ready", {
    createIteration: 4,
    postponedUntil: "2026-04-04T12:00:00.000Z",
    lastSyncedStorageVersion: null,
  });

  assert.equal(getProjectBankContinuationIteration(postponedState), 5);
  assert.equal(requiresProjectBankSync(postponedState, 1), true);
  assert.equal(isProjectBankSyncPostponed(postponedState, now), true);
});
