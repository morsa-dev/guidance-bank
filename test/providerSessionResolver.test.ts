import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ProviderSessionResolver } from "../src/mcp/providerSessionResolver.js";
import { writeClaudeCodeSessionState } from "../src/mcp/providerSessionState.js";

test("provider session resolver resolves codex thread ids from the parent process logs database", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-provider-session-"));
  const homePath = path.join(tempDirectoryPath, "home");
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const codexRoot = path.join(homePath, ".codex");

  await mkdir(codexRoot, { recursive: true });

  const databasePath = path.join(codexRoot, "logs_2.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      ts_nanos INTEGER NOT NULL DEFAULT 0,
      level TEXT NOT NULL DEFAULT 'INFO',
      target TEXT NOT NULL DEFAULT 'test',
      feedback_log_body TEXT,
      module_path TEXT,
      file TEXT,
      line INTEGER,
      thread_id TEXT,
      process_uuid TEXT,
      estimated_bytes INTEGER NOT NULL DEFAULT 0
    );
  `);
  database
    .prepare("INSERT INTO logs (ts, thread_id, process_uuid) VALUES (?, ?, ?)")
    .run(100, "", "pid:4321:empty");
  database
    .prepare("INSERT INTO logs (ts, thread_id, process_uuid) VALUES (?, ?, ?)")
    .run(200, "019e-codex-thread", "pid:4321:actual-process");
  database.close();

  const resolver = new ProviderSessionResolver("codex", {
    bankRoot,
    homePath,
    parentPid: 4321,
  });

  assert.deepEqual(await resolver.resolve(), {
    providerSessionId: "019e-codex-thread",
    providerSessionSource: "codex_parent_process",
  });
});

test("provider session resolver resolves cursor agent ids from the active Cursor state database", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-provider-session-"));
  const homePath = path.join(tempDirectoryPath, "home");
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const projectPath = "/tmp/cursor-project";
  const cursorStateRoot = path.join(
    homePath,
    "Library",
    "Application Support",
    "Cursor",
    "User",
    "globalStorage",
  );

  await mkdir(cursorStateRoot, { recursive: true });

  const databasePath = path.join(cursorStateRoot, "state.vscdb");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  database
    .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
    .run("cursor/glass.selectedAgent", "cursor-agent-123");
  database
    .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
    .run(
      "cursor/glass.startupDefaultStateRecentEnvironmentCache",
      JSON.stringify({
        environment: {
          environment: {
            uri: {
              fsPath: projectPath,
            },
          },
        },
      }),
    );
  database.close();

  const resolver = new ProviderSessionResolver("cursor", {
    bankRoot,
    homePath,
  });

  assert.deepEqual(await resolver.resolve({ projectPath }), {
    providerSessionId: "cursor-agent-123",
    providerSessionSource: "cursor_state",
  });
});

test("provider session resolver resolves claude-code session ids from the hook state file", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-provider-session-"));
  const homePath = path.join(tempDirectoryPath, "home");
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const projectPath = "/tmp/claude-project";

  await writeClaudeCodeSessionState(bankRoot, {
    schemaVersion: 1,
    provider: "claude-code",
    sessionId: "claude-session-123",
    cwd: projectPath,
    transcriptPath: "/tmp/claude-project/session.jsonl",
    capturedAt: "2026-05-08T10:00:00.000Z",
  });

  const resolver = new ProviderSessionResolver("claude-code", {
    bankRoot,
    homePath,
  });

  assert.deepEqual(await resolver.resolve({ projectPath }), {
    providerSessionId: "claude-session-123",
    providerSessionSource: "claude_code_hook",
  });
});

test("provider session resolver degrades to unresolved when the codex logs database is unreadable", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-provider-session-"));
  const homePath = path.join(tempDirectoryPath, "home");
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const codexRoot = path.join(homePath, ".codex");

  await mkdir(codexRoot, { recursive: true });
  await writeFile(path.join(codexRoot, "logs_2.sqlite"), "not-a-sqlite-database\n", "utf8");

  const resolver = new ProviderSessionResolver("codex", {
    bankRoot,
    homePath,
    parentPid: 4321,
  });

  assert.deepEqual(await resolver.resolve(), {
    providerSessionId: null,
    providerSessionSource: "unresolved",
  });
});

test("provider session resolver degrades to unresolved when the cursor state database is unreadable", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-provider-session-"));
  const homePath = path.join(tempDirectoryPath, "home");
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const projectPath = "/tmp/cursor-project";
  const cursorStateRoot = path.join(
    homePath,
    "Library",
    "Application Support",
    "Cursor",
    "User",
    "globalStorage",
  );

  await mkdir(cursorStateRoot, { recursive: true });
  await writeFile(path.join(cursorStateRoot, "state.vscdb"), "not-a-sqlite-database\n", "utf8");

  const resolver = new ProviderSessionResolver("cursor", {
    bankRoot,
    homePath,
  });

  assert.deepEqual(await resolver.resolve({ projectPath }), {
    providerSessionId: null,
    providerSessionSource: "unresolved",
  });
});
