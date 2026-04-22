import type { EntryKind, EntryScope, ProviderId } from "../bank/types.js";

export type AuditEntrySnapshot = {
  exists: boolean;
  sha256: string | null;
  charCount: number;
  lineCount: number;
  entryId: string | null;
  title: string | null;
  entryKind: "rule" | "skill" | null;
  stack: string | null;
  topics: string[];
};

export type EntryAuditEvent = {
  schemaVersion: 1;
  eventId: string;
  timestamp: string;
  provider: ProviderId | null;
  sessionRef: string | null;
  tool: "upsert_rule" | "upsert_skill" | "delete_entry" | "create_bank";
  action: "upsert" | "delete";
  scope: EntryScope;
  kind: EntryKind;
  projectId: string;
  projectPath: string;
  path: string;
  before: AuditEntrySnapshot;
  after: AuditEntrySnapshot;
  deltaChars: number;
  deltaLines: number;
};

export type EntryVersionEvent = {
  schemaVersion: 1;
  eventId: string;
  auditEventId: string;
  timestamp: string;
  provider: ProviderId | null;
  sessionRef: string | null;
  tool: EntryAuditEvent["tool"];
  action: EntryAuditEvent["action"];
  scope: EntryScope;
  kind: EntryKind;
  projectId: string;
  projectPath: string;
  path: string;
  before: AuditEntrySnapshot;
  after: AuditEntrySnapshot;
  beforeContent: string | null;
  afterContent: string | null;
  unifiedDiff: string;
};

export type GuidanceSourceFileSnapshot = {
  relativePath: string;
  sha256: string;
  byteCount: number;
  contentBase64: string;
};

export type GuidanceSourceVersionEvent = {
  schemaVersion: 1;
  eventId: string;
  timestamp: string;
  provider: ProviderId | null;
  sessionRef: string | null;
  tool: "delete_guidance_source";
  action: "delete_snapshot";
  projectId: string;
  projectPath: string;
  sourcePath: string;
  relativePath: string;
  kind: string;
  scope: "repository-local" | "provider-project" | "provider-global";
  sourceProvider: "codex" | "cursor" | "claude" | null;
  entryType: "file" | "directory";
  files: GuidanceSourceFileSnapshot[];
};

export type ToolAuditEvent = {
  schemaVersion: 1;
  eventId: string;
  timestamp: string;
  provider: ProviderId | null;
  sessionRef: string | null;
  tool:
    | "create_bank"
    | "improve_bank"
    | "upgrade_bank"
    | "resolve_context"
    | "set_project_state"
    | "sync_bank"
    | "clear_project_bank"
    | "delete_guidance_source";
  action: "create_flow" | "upgrade" | "resolve" | "set_state" | "sync" | "clear" | "delete_guidance";
  projectId: string;
  projectPath: string;
  details: Record<string, unknown>;
};

export type AuditEvent = EntryAuditEvent | ToolAuditEvent;
