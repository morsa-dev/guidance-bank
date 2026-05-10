import type { EntryKind, EntryScope } from "../../core/bank/types.js";
import { createUnifiedDiff } from "../../core/audit/createUnifiedDiff.js";
import { summarizeEntryContent } from "../../core/audit/summarizeEntryContent.js";
import type { AuditLogger } from "../../storage/auditLogger.js";
import type { ResolvedProviderSession } from "../providerSessionResolver.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";

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
  providerSession: ResolvedProviderSession;
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
  providerSession,
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
    const auditEvent = await auditLogger.writeEvent({
      providerSessionId: providerSession.providerSessionId,
      providerSessionSource: providerSession.providerSessionSource,
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
      providerSessionId: providerSession.providerSessionId,
      providerSessionSource: providerSession.providerSessionSource,
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
  providerSession: ResolvedProviderSession;
  tool: ToolAuditTool;
  action: "create_flow" | "upgrade" | "resolve" | "set_state" | "sync" | "clear";
  projectId: string;
  projectPath: string;
  details: Record<string, unknown>;
  metrics?: {
    contextChars: number;
    estimatedTokens: number;
    entriesCount?: number;
    alwaysOnChars?: number;
  };
};

export const writeToolAuditEvent = async ({
  auditLogger,
  providerSession,
  tool,
  action,
  projectId,
  projectPath,
  details,
  metrics,
}: WriteToolAuditEventInput): Promise<void> => {
  try {
    await auditLogger.writeEvent({
      providerSessionId: providerSession.providerSessionId,
      providerSessionSource: providerSession.providerSessionSource,
      tool,
      action,
      projectId,
      projectPath,
      details,
      metrics,
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
