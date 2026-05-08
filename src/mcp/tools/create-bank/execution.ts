import {
  createProjectBankManifest,
} from "../../../core/bank/project.js";
import { ensureProjectLocalBankStructure } from "../../../core/bank/projectLocalBank.js";
import { discoverCurrentProjectBank } from "../../../core/projects/discoverCurrentProjectBank.js";
import { discoverProjectLocalBank } from "../../../core/projects/discoverProjectLocalBank.js";
import type { ResolvedCreateBankFlowContext } from "../../../core/projects/create-flow/createBankFlow.js";
import type { ProjectLocalEntryStore } from "../../../storage/projectLocalEntryStore.js";
import type { McpServerRuntimeOptions } from "../../registerTools.js";
import type { ResolvedProviderSession } from "../../providerSessionResolver.js";
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

  if (flowContext.storageMode === "project-local") {
    await ensureProjectLocalBankStructure(flowContext.identity.projectPath);
  }

  await options.repository.writeProjectManifest(
    flowContext.identity.projectId,
    createProjectBankManifest(
      flowContext.identity.projectId,
      flowContext.identity.projectName,
      flowContext.identity.projectPath,
      flowContext.projectContext.detectedStacks,
      new Date(),
      flowContext.storageMode,
    ),
  );
};

export const applyCreateBankRequestChanges = async ({
  options,
  flowContext,
  args,
  providerSession,
  projectLocalEntryStore,
}: {
  options: McpServerRuntimeOptions;
  flowContext: ResolvedCreateBankFlowContext;
  args: CreateBankArgs;
  providerSession: ResolvedProviderSession;
  projectLocalEntryStore?: ProjectLocalEntryStore;
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
        providerSession,
        writes: normalizeApplyWrites(args.apply.writes),
        deletions: normalizeApplyDeletions(args.apply.deletions),
        ...(projectLocalEntryStore !== undefined ? { projectLocalEntryStore } : {}),
      })
    : {
        writes: [],
        deletions: [],
      };

  if (args.apply) {
    currentBankSnapshot =
      projectLocalEntryStore !== undefined
        ? await discoverProjectLocalBank(projectLocalEntryStore, true)
        : await discoverCurrentProjectBank(options.repository, flowContext.identity.projectId, true);
  }

  return {
    currentBankSnapshot,
    applyResults,
  };
};
