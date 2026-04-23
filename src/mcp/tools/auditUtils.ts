import type { EntryKind, EntryScope } from "../../core/bank/types.js";
import { createUnifiedDiff } from "../../core/audit/createUnifiedDiff.js";
import { summarizeEntryContent } from "../../core/audit/summarizeEntryContent.js";
import type { AuditLogger } from "../../storage/auditLogger.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { resolveAuditSessionRef } from "./sessionRefResolver.js";

type EntryMutationAuditTool =
  | typeof MCP_TOOL_NAMES.upsertRule
  | typeof MCP_TOOL_NAMES.upsertSkill
  | typeof MCP_TOOL_NAMES.deleteEntry
  | typeof MCP_TOOL_NAMES.createBank;

type ToolAuditTool =
  | typeof MCP_TOOL_NAMES.createBank
  | typeof MCP_TOOL_NAMES.improveBank
  | typeof MCP_TOOL_NAMES.upgradeBank
  | typeof MCP_TOOL_NAMES.resolveContext
  | typeof MCP_TOOL_NAMES.setProjectState
  | typeof MCP_TOOL_NAMES.syncBank
  | typeof MCP_TOOL_NAMES.clearProjectBank;

type WriteEntryAuditEventInput = {
  auditLogger: AuditLogger;
  sessionRef: string | null;
  tool: EntryMutationAuditTool;
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
  const effectiveSessionRef = resolveAuditSessionRef(sessionRef);

  try {
    const auditEvent = await auditLogger.writeEvent({
      sessionRef: effectiveSessionRef,
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
    await auditLogger.writeEntryVersion({
      auditEventId: auditEvent.eventId,
      sessionRef: effectiveSessionRef,
      tool,
      action,
      scope,
      kind,
      projectId,
      projectPath,
      path,
      before,
      after,
      beforeContent,
      afterContent,
      unifiedDiff: createUnifiedDiff({
        path,
        beforeContent,
        afterContent,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown audit logging error.";
    console.warn(`Failed to write AI Guidance Bank audit event for ${tool} ${scope}/${path}: ${message}`);
  }
};

type WriteToolAuditEventInput = {
  auditLogger: AuditLogger;
  sessionRef: string;
  tool: ToolAuditTool;
  action: "create_flow" | "upgrade" | "resolve" | "set_state" | "sync" | "clear";
  projectId: string;
  projectPath: string;
  details: Record<string, unknown>;
};

export const writeToolAuditEvent = async ({
  auditLogger,
  sessionRef,
  tool,
  action,
  projectId,
  projectPath,
  details,
}: WriteToolAuditEventInput): Promise<void> => {
  const effectiveSessionRef = resolveAuditSessionRef(sessionRef);

  try {
    await auditLogger.writeEvent({
      sessionRef: effectiveSessionRef,
      tool,
      action,
      projectId,
      projectPath,
      details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown audit logging error.";
    console.warn(`Failed to write AI Guidance Bank audit event for ${tool} ${projectPath}: ${message}`);
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
