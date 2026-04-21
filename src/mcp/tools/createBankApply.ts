import { summarizeEntryContent } from "../../core/audit/summarizeEntryContent.js";
import type { EntryKind, EntryScope } from "../../core/bank/types.js";
import type { AuditLogger } from "../../storage/auditLogger.js";
import type { BankRepository } from "../../storage/bankRepository.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { writeEntryAuditEvent } from "./auditUtils.js";
import { readEntryBeforeMutation } from "./entryMutationHelpers.js";

export type CreateBankApplyWrite = {
  kind: EntryKind;
  scope: EntryScope;
  path: string;
  content: string;
  baseSha256?: string;
};

export type CreateBankApplyDeletion = {
  kind: EntryKind;
  scope: EntryScope;
  path: string;
  baseSha256?: string;
};

type ApplyCreateBankChangesOptions = {
  repository: BankRepository;
  auditLogger: AuditLogger;
  projectId: string;
  projectPath: string;
  sessionRef: string | null;
  writes: readonly CreateBankApplyWrite[];
  deletions: readonly CreateBankApplyDeletion[];
};

type CreateBankApplyResultItemBase = {
  kind: EntryKind;
  scope: EntryScope;
  path: string;
  expectedSha256: string | null;
  actualSha256: string | null;
};

export type CreateBankApplyWriteResult =
  | (CreateBankApplyResultItemBase & {
      status: "created" | "updated";
    })
  | (CreateBankApplyResultItemBase & {
      status: "conflict";
    });

export type CreateBankApplyDeletionResult =
  | (CreateBankApplyResultItemBase & {
      status: "deleted" | "not_found";
    })
  | (CreateBankApplyResultItemBase & {
      status: "conflict";
    });

export type CreateBankApplyResults = {
  writes: CreateBankApplyWriteResult[];
  deletions: CreateBankApplyDeletionResult[];
};

const resolveActualSha256 = (kind: EntryKind, content: string | null): string | null =>
  summarizeEntryContent(kind, content).sha256;

export const applyCreateBankChanges = async ({
  repository,
  auditLogger,
  projectId,
  projectPath,
  sessionRef,
  writes,
  deletions,
}: ApplyCreateBankChangesOptions): Promise<CreateBankApplyResults> => {
  const writeResults: CreateBankApplyWriteResult[] = [];
  const deletionResults: CreateBankApplyDeletionResult[] = [];

  for (const write of writes) {
    const beforeContent = await readEntryBeforeMutation({
      repository,
      scope: write.scope,
      kind: write.kind,
      path: write.path,
      ...(write.scope === "project" ? { projectId } : {}),
    });
    const actualSha256 = resolveActualSha256(write.kind, beforeContent);
    const expectedSha256 = write.baseSha256 ?? null;

    if (write.baseSha256 !== undefined && write.baseSha256 !== actualSha256) {
      writeResults.push({
        kind: write.kind,
        scope: write.scope,
        path: write.path,
        status: "conflict",
        expectedSha256,
        actualSha256,
      });
      continue;
    }

    const result =
      write.kind === "rules"
        ? await repository.upsertRule(write.scope, write.path, write.content, write.scope === "project" ? projectId : undefined)
        : await repository.upsertSkill(
            write.scope,
            write.path,
            write.content,
            write.scope === "project" ? projectId : undefined,
          );

    await writeEntryAuditEvent({
      auditLogger,
      sessionRef,
      tool: MCP_TOOL_NAMES.createBank,
      action: "upsert",
      scope: write.scope,
      kind: write.kind,
      projectId,
      projectPath,
      path: result.path,
      beforeContent,
      afterContent: write.content,
    });

    writeResults.push({
      kind: write.kind,
      scope: write.scope,
      path: result.path,
      status: result.status,
      expectedSha256,
      actualSha256: resolveActualSha256(write.kind, write.content),
    });
  }

  for (const deletion of deletions) {
    const beforeContent = await readEntryBeforeMutation({
      repository,
      scope: deletion.scope,
      kind: deletion.kind,
      path: deletion.path,
      ...(deletion.scope === "project" ? { projectId } : {}),
    });
    const actualSha256 = resolveActualSha256(deletion.kind, beforeContent);
    const expectedSha256 = deletion.baseSha256 ?? null;

    if (deletion.baseSha256 !== undefined && deletion.baseSha256 !== actualSha256) {
      deletionResults.push({
        kind: deletion.kind,
        scope: deletion.scope,
        path: deletion.path,
        status: "conflict",
        expectedSha256,
        actualSha256,
      });
      continue;
    }

    const result =
      deletion.kind === "rules"
        ? await repository.deleteRule(
            deletion.scope,
            deletion.path,
            deletion.scope === "project" ? projectId : undefined,
          )
        : await repository.deleteSkill(
            deletion.scope,
            deletion.path,
            deletion.scope === "project" ? projectId : undefined,
          );

    if (result.status === "deleted") {
      await writeEntryAuditEvent({
        auditLogger,
        sessionRef,
        tool: MCP_TOOL_NAMES.createBank,
        action: "delete",
        scope: deletion.scope,
        kind: deletion.kind,
        projectId,
        projectPath,
        path: result.path,
        beforeContent,
        afterContent: null,
      });
    }

    deletionResults.push({
      kind: deletion.kind,
      scope: deletion.scope,
      path: result.path,
      status: result.status,
      expectedSha256,
      actualSha256,
    });
  }

  return {
    writes: writeResults,
    deletions: deletionResults,
  };
};
