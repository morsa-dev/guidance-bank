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
    | "clear_project_bank";
  action: "create_flow" | "upgrade" | "resolve" | "set_state" | "sync" | "clear";
  projectId: string;
  projectPath: string;
  details: Record<string, unknown>;
};

export type AuditEvent = EntryAuditEvent | ToolAuditEvent;
