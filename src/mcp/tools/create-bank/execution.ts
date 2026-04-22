import {
  createProjectBankManifest,
} from "../../../core/bank/project.js";
import { discoverCurrentProjectBank } from "../../../core/projects/discoverCurrentProjectBank.js";
import type { ResolvedCreateBankFlowContext } from "../../../core/projects/create-flow/createBankFlow.js";
import type { McpServerRuntimeOptions } from "../../registerTools.js";
import { applyCreateBankChanges, type CreateBankApplyResults } from "./apply.js";
import { normalizeApplyDeletions, normalizeApplyWrites } from "./runtime.js";
import type { CreateBankArgs } from "./schemas.js";

export const ensureCreateFlowProjectManifest = async ({
  options,
  flowContext,
}: {
  options: McpServerRuntimeOptions;
  flowContext: ResolvedCreateBankFlowContext;
}): Promise<void> => {
  if (flowContext.existingManifest !== null) {
    return;
  }

  await options.repository.ensureProjectStructure(flowContext.identity.projectId);
  await options.repository.writeProjectManifest(
    flowContext.identity.projectId,
    createProjectBankManifest(
      flowContext.identity.projectId,
      flowContext.identity.projectName,
      flowContext.identity.projectPath,
      flowContext.projectContext.detectedStacks,
    ),
  );
};

export const applyCreateBankRequestChanges = async ({
  options,
  flowContext,
  args,
}: {
  options: McpServerRuntimeOptions;
  flowContext: ResolvedCreateBankFlowContext;
  args: CreateBankArgs;
}): Promise<{
  currentBankSnapshot: ResolvedCreateBankFlowContext["extendedContext"]["currentBankSnapshot"];
  applyResults: CreateBankApplyResults;
}> => {
  let currentBankSnapshot =
    flowContext.existingManifest === null
      ? {
          ...flowContext.extendedContext.currentBankSnapshot,
          exists: true,
        }
      : flowContext.extendedContext.currentBankSnapshot;

  const applyResults = args.apply
    ? await applyCreateBankChanges({
        repository: options.repository,
        auditLogger: options.auditLogger,
        projectId: flowContext.identity.projectId,
        projectPath: flowContext.identity.projectPath,
        sessionRef: args.sessionRef ?? null,
        writes: normalizeApplyWrites(args.apply.writes),
        deletions: normalizeApplyDeletions(args.apply.deletions),
      })
    : {
        writes: [],
        deletions: [],
      };

  if (args.apply) {
    currentBankSnapshot = await discoverCurrentProjectBank(
      options.repository,
      flowContext.identity.projectId,
      true,
    );
  }

  return {
    currentBankSnapshot,
    applyResults,
  };
};
