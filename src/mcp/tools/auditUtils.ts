import type { EntryKind, EntryScope } from "../../core/bank/types.js";
import { summarizeEntryContent } from "../../core/audit/summarizeEntryContent.js";
import type { AuditLogger } from "../../storage/auditLogger.js";

type WriteEntryAuditEventInput = {
  auditLogger: AuditLogger;
  sessionRef: string | null;
  tool: "upsert_rule" | "upsert_skill" | "delete_entry" | "create_bank";
  action: "upsert" | "delete";
  scope: EntryScope;
  kind: EntryKind;
  projectId: string;
  projectPath: string;
  path: string;
  beforeContent: string | null;
  afterContent: string | null;
};

export const writeEntryAuditEvent = async ({
  auditLogger,
  sessionRef,
  tool,
  action,
  scope,
  kind,
  projectId,
  projectPath,
  path,
  beforeContent,
  afterContent,
}: WriteEntryAuditEventInput): Promise<void> => {
  const before = summarizeEntryContent(kind, beforeContent);
  const after = summarizeEntryContent(kind, afterContent);

  try {
    await auditLogger.writeEvent({
      sessionRef,
      tool,
      action,
      scope,
      kind,
      projectId,
      projectPath,
      path,
      before,
      after,
      deltaChars: after.charCount - before.charCount,
      deltaLines: after.lineCount - before.lineCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown audit logging error.";
    console.warn(`Failed to write Memory Bank audit event for ${tool} ${scope}/${path}: ${message}`);
  }
};

export const toSkillDocumentPath = (skillPath: string): string => {
  const trimmedPath = skillPath.replaceAll("\\", "/").trim().replace(/\/+$/u, "");
  const lowerCasePath = trimmedPath.toLowerCase();

  if (lowerCasePath.endsWith("/skill.md")) {
    return `${trimmedPath.slice(0, -"skill.md".length)}SKILL.md`;
  }

  return `${trimmedPath}/SKILL.md`;
};
