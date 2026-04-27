import { getCreateFlowPhase } from "../../../core/projects/create-flow/createFlowPhases.js";
import type { ResolvedCreateBankFlowContext } from "../../../core/projects/create-flow/createBankFlow.js";
import {
  getCreateBankApplyBlockedMessage,
  shouldWarnAboutIterationMismatch,
} from "./runtime.js";
import type { CreateBankArgs } from "./schemas.js";

export const getCreateBankRequestError = ({
  toolName,
  args,
  flowContext,
}: {
  toolName: string;
  args: CreateBankArgs;
  flowContext: ResolvedCreateBankFlowContext;
}): string | null => {
  if (flowContext.unknownReferenceIds.length > 0) {
    return `Unknown reference project ids for tool ${toolName}: ${flowContext.unknownReferenceIds.join(", ")}`;
  }

  const phase =
    flowContext.syncRequired
      ? "sync_required"
      : flowContext.improvementEntryPoint
        ? "ready_to_improve"
        : getCreateFlowPhase(flowContext.effectiveIteration);

  const isImportingCurrentReviewBucket =
    args.sourceReviewDecision === "import_to_bank" && flowContext.resolvedReviewBucket !== null;
  const hasApplyChanges =
    args.apply !== undefined && (args.apply.writes.length > 0 || args.apply.deletions.length > 0);

  if (isImportingCurrentReviewBucket && !hasApplyChanges) {
    return "During review_existing_guidance, `import_to_bank` must complete the current bucket in the same call. Include non-empty `create_bank.apply` and `stepCompleted: true`.";
  }

  if (isImportingCurrentReviewBucket && (args.stepCompleted ?? false) !== true) {
    return "During review_existing_guidance, `import_to_bank` must finish the current bucket in one call. Include `stepCompleted: true` together with `create_bank.apply`.";
  }

  return getCreateBankApplyBlockedMessage({
    hasApply: args.apply !== undefined,
    syncRequired: flowContext.syncRequired,
    improvementEntryPoint: flowContext.improvementEntryPoint,
    phase,
    hasDiscoveredSources: flowContext.extendedContext.discoveredSources.length > 0,
    sourceReviewDecision: args.sourceReviewDecision,
    stepCompletionRequired: flowContext.stepCompletionRequired,
    sourceStrategyRequired: flowContext.sourceStrategyRequired,
    stepOutcomeRequired: flowContext.stepOutcomeRequired,
  });
};

export const shouldLogIterationMismatch = ({
  flowContext,
  requestedIteration,
}: {
  flowContext: ResolvedCreateBankFlowContext;
  requestedIteration: number;
}): boolean =>
  flowContext.existingState !== null &&
  shouldWarnAboutIterationMismatch(
    flowContext.existingState.createIteration,
    requestedIteration,
    flowContext.effectiveIteration,
    flowContext.stepCompletionRequired,
    flowContext.sourceStrategyRequired,
    flowContext.stepOutcomeRequired,
  );
