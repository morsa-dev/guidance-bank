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

  return getCreateBankApplyBlockedMessage({
    hasApply: args.apply !== undefined,
    syncRequired: flowContext.syncRequired,
    improvementEntryPoint: flowContext.improvementEntryPoint,
    phase: flowContext.syncRequired
      ? "sync_required"
      : flowContext.improvementEntryPoint
        ? "ready_to_improve"
        : getCreateFlowPhase(flowContext.effectiveIteration),
    hasDiscoveredSources: flowContext.extendedContext.discoveredSources.length > 0,
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
