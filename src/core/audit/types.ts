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

export type AuditEvent = {
  schemaVersion: 1;
  eventId: string;
  timestamp: string;
  provider: ProviderId | null;
  sessionRef: string | null;
  tool: "upsert_rule" | "upsert_skill" | "delete_entry";
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
