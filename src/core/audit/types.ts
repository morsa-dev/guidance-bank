import type { EntryKind, EntryScope, ProviderId } from "../bank/types.js";

export type AuditEntrySnapshot = {
  exists: boolean;
  sha256: string | null;
  charCount: number;
  lineCount: number;
  entryId: string | null;
  title: string | null;
  entryKind: "rule" | "skill" | null;
  stacks: string[];
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
