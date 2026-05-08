import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ProviderId } from "../core/bank/types.js";
import { readClaudeCodeSessionState } from "./providerSessionState.js";

export const PROVIDER_SESSION_SOURCES = [
  "codex_parent_process",
  "cursor_state",
  "claude_code_hook",
  "unresolved",
] as const;

export type ProviderSessionSource = (typeof PROVIDER_SESSION_SOURCES)[number];

export type ResolvedProviderSession = {
  providerSessionId: string | null;
  providerSessionSource: ProviderSessionSource;
};

export type ProviderSessionResolverOptions = {
  bankRoot: string;
  homePath?: string;
  parentPid?: number;
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const normalizePath = (targetPath: string): string => path.resolve(targetPath);

const unresolvedSession = (): ResolvedProviderSession => ({
  providerSessionId: null,
  providerSessionSource: "unresolved",
});

const resolveSafely = async (resolver: () => Promise<ResolvedProviderSession>): Promise<ResolvedProviderSession> => {
  try {
    return await resolver();
  } catch {
    return unresolvedSession();
  }
};

const resolveCodexProcessUuidPrefix = (parentPid: number): string | null =>
  parentPid > 0 ? `pid:${parentPid}:` : null;

const querySingleText = (
  databasePath: string,
  sql: string,
  parameters: Record<string, string | number | bigint | Uint8Array | null>,
): string | null => {
  const database = new DatabaseSync(databasePath, { readOnly: true });

  try {
    const row = database.prepare(sql).get(parameters) as Record<string, unknown> | undefined;
    const value = row?.value;
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  } finally {
    database.close();
  }
};

const resolveCodexSession = async (homePath: string, parentPid: number): Promise<ResolvedProviderSession> => {
  const processUuidPrefix = resolveCodexProcessUuidPrefix(parentPid);
  if (processUuidPrefix === null) {
    return unresolvedSession();
  }

  const databasePath = path.join(homePath, ".codex", "logs_2.sqlite");
  if (!(await pathExists(databasePath))) {
    return unresolvedSession();
  }

  const threadId = querySingleText(
    databasePath,
    `
      SELECT thread_id AS value
      FROM logs
      WHERE process_uuid LIKE :processUuidPrefix || '%'
        AND thread_id IS NOT NULL
        AND thread_id != ''
      ORDER BY ts DESC, id DESC
      LIMIT 1
    `,
    { processUuidPrefix },
  );

  return threadId === null
    ? unresolvedSession()
    : {
        providerSessionId: threadId,
        providerSessionSource: "codex_parent_process",
      };
};

const resolveCursorStateDatabasePath = async (homePath: string): Promise<string | null> => {
  const candidates = [
    path.join(homePath, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
    path.join(homePath, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
};

const parseCursorEnvironmentProjectPath = (rawValue: string): string | null => {
  try {
    const parsed = JSON.parse(rawValue) as {
      environment?: {
        environment?: {
          uri?: {
            fsPath?: unknown;
          };
        };
      };
    };

    const fsPath = parsed.environment?.environment?.uri?.fsPath;
    return typeof fsPath === "string" && fsPath.trim().length > 0 ? fsPath : null;
  } catch {
    return null;
  }
};

const resolveCursorSession = async (homePath: string, projectPath: string): Promise<ResolvedProviderSession> => {
  const databasePath = await resolveCursorStateDatabasePath(homePath);
  if (databasePath === null) {
    return unresolvedSession();
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });

  try {
    const selectedAgentRow = database
      .prepare("SELECT value FROM ItemTable WHERE key = 'cursor/glass.selectedAgent' LIMIT 1")
      .get() as { value?: unknown } | undefined;
    const activeEnvironmentRow = database
      .prepare("SELECT value FROM ItemTable WHERE key = 'cursor/glass.startupDefaultStateRecentEnvironmentCache' LIMIT 1")
      .get() as { value?: unknown } | undefined;

    const selectedAgent =
      typeof selectedAgentRow?.value === "string" && selectedAgentRow.value.trim().length > 0
        ? selectedAgentRow.value.trim()
        : null;
    const activeEnvironmentProjectPath =
      typeof activeEnvironmentRow?.value === "string"
        ? parseCursorEnvironmentProjectPath(activeEnvironmentRow.value)
        : null;

    if (
      selectedAgent === null ||
      activeEnvironmentProjectPath === null ||
      normalizePath(activeEnvironmentProjectPath) !== normalizePath(projectPath)
    ) {
      return unresolvedSession();
    }

    return {
      providerSessionId: selectedAgent,
      providerSessionSource: "cursor_state",
    };
  } finally {
    database.close();
  }
};

const resolveClaudeCodeSession = async (bankRoot: string, projectPath: string): Promise<ResolvedProviderSession> => {
  const state = await readClaudeCodeSessionState(bankRoot);
  if (state?.cwd === null || state?.cwd === undefined) {
    return unresolvedSession();
  }

  // Claude currently records hook state out-of-band, so this stays best-effort until
  // the provider exposes a per-tool-call session identifier directly to the MCP server.
  return normalizePath(state.cwd) === normalizePath(projectPath)
    ? {
        providerSessionId: state.sessionId,
        providerSessionSource: "claude_code_hook",
      }
    : unresolvedSession();
};

export class ProviderSessionResolver {
  private readonly bankRoot: string;
  private readonly homePath: string;
  private readonly parentPid: number;

  constructor(
    private readonly provider: ProviderId | null,
    options: ProviderSessionResolverOptions,
  ) {
    this.bankRoot = options.bankRoot;
    this.homePath = options.homePath ?? os.homedir();
    this.parentPid = options.parentPid ?? process.ppid;
  }

  async resolve(input: { projectPath?: string } = {}): Promise<ResolvedProviderSession> {
    if (this.provider === "codex") {
      return resolveSafely(async () => resolveCodexSession(this.homePath, this.parentPid));
    }

    if (input.projectPath === undefined) {
      return unresolvedSession();
    }

    const projectPath = input.projectPath;

    if (this.provider === "cursor") {
      return resolveSafely(async () => resolveCursorSession(this.homePath, projectPath));
    }

    if (this.provider === "claude-code") {
      return resolveSafely(async () => resolveClaudeCodeSession(this.bankRoot, projectPath));
    }

    return unresolvedSession();
  }
}
