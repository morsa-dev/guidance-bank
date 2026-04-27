import type { CreateFlowPhase } from "../../../core/projects/create-flow/createFlowPhases.js";
import type { PendingSourceReviewBucket } from "../../../core/projects/create-flow/sourceReviewBuckets.js";
import type { CreateBankApplyResults } from "./apply.js";
import type { CreateBankArgs } from "./schemas.js";

export const shouldWarnAboutIterationMismatch = (
  storedIteration: number | null,
  requestedIteration: number,
  effectiveIteration: number,
  stepCompletionRequired: boolean,
  sourceStrategyRequired: boolean,
  stepOutcomeRequired: boolean,
): boolean => {
  if (storedIteration === null) {
    return false;
  }

  if (stepCompletionRequired) {
    return false;
  }

  if (sourceStrategyRequired) {
    return false;
  }

  if (stepOutcomeRequired) {
    return false;
  }

  if (requestedIteration === storedIteration + 1 && effectiveIteration === storedIteration) {
    return false;
  }

  if (requestedIteration === effectiveIteration) {
    return false;
  }

  if (requestedIteration === 0) {
    return false;
  }

  if (requestedIteration <= storedIteration) {
    return false;
  }

  if (effectiveIteration > requestedIteration) {
    return false;
  }

  return true;
};

export const normalizeApplyWrites = (writes: NonNullable<CreateBankArgs["apply"]>["writes"]) =>
  writes.map((write) => ({
    kind: write.kind,
    scope: write.scope,
    path: write.path,
    content: write.content,
    ...(write.baseSha256 !== undefined ? { baseSha256: write.baseSha256 } : {}),
  }));

export const normalizeApplyDeletions = (deletions: NonNullable<CreateBankArgs["apply"]>["deletions"]) =>
  deletions.map((deletion) => ({
    kind: deletion.kind,
    scope: deletion.scope,
    path: deletion.path,
    ...(deletion.baseSha256 !== undefined ? { baseSha256: deletion.baseSha256 } : {}),
  }));

export const getCreateBankApplyBlockedMessage = ({
  hasApply,
  syncRequired,
  improvementEntryPoint,
  phase,
  hasDiscoveredSources,
  sourceReviewDecision,
  stepCompletionRequired,
  sourceStrategyRequired,
  stepOutcomeRequired,
}: {
  hasApply: boolean;
  syncRequired: boolean;
  improvementEntryPoint: boolean;
  phase: CreateFlowPhase;
  hasDiscoveredSources: boolean;
  sourceReviewDecision: CreateBankArgs["sourceReviewDecision"];
  stepCompletionRequired: boolean;
  sourceStrategyRequired: boolean;
  stepOutcomeRequired: boolean;
}): string | null => {
  if (!hasApply) {
    return null;
  }

  if (syncRequired) {
    return "Cannot apply create-flow changes while sync_bank is required. Reconcile the existing project bank first.";
  }

  if (improvementEntryPoint) {
    return "Cannot apply create-flow changes from the ready-to-improve entry point. Ask the user whether to improve the existing bank first, then continue with iteration: 1.";
  }

  if (phase === "review_existing_guidance") {
    if (sourceReviewDecision !== "import_to_bank") {
      return "Cannot apply create-flow changes during review_existing_guidance unless this call also resolves the current review bucket with sourceReviewDecision: `import_to_bank`.";
    }

    return null;
  }

  if (phase === "kickoff" && hasDiscoveredSources) {
    return "Cannot apply create-flow changes during kickoff while external guidance sources still need review. Finish the source review first, then continue with import or derive.";
  }

  if (stepCompletionRequired) {
    return "Cannot apply create-flow changes while step completion is unresolved. Re-call create_bank for the current step before applying changes or advancing.";
  }

  if (sourceStrategyRequired) {
    return "Cannot apply create-flow changes until the current external guidance review is resolved. Re-call create_bank for the review phase with sourceReviewDecision (`import_to_bank` or `keep_external`) before importing or applying changes.";
  }

  if (stepOutcomeRequired) {
    return "Cannot apply create-flow changes while the previous phase still needs an explicit outcome. Re-call create_bank for the current phase, then advance with either create_bank.apply results or stepOutcome.";
  }

  return null;
};

const hasAppliedChanges = (applyResults: CreateBankApplyResults): boolean =>
  applyResults.writes.length > 0 || applyResults.deletions.length > 0;

const hasApplyConflicts = (applyResults: CreateBankApplyResults): boolean =>
  applyResults.writes.some((item) => item.status === "conflict") ||
  applyResults.deletions.some((item) => item.status === "conflict");

export const buildCreateBankResponseText = ({
  syncRequired,
  applyResults,
  stepCompletionRequired,
  sourceStrategyRequired,
  stepOutcomeRequired,
  pendingSourceReviewBuckets,
  nextIteration,
  improvementEntryPoint,
  mustContinue,
  completedFlowThisCall,
  phase,
}: {
  syncRequired: boolean;
  applyResults: CreateBankApplyResults;
  stepCompletionRequired: boolean;
  sourceStrategyRequired: boolean;
  stepOutcomeRequired: boolean;
  pendingSourceReviewBuckets: PendingSourceReviewBucket[];
  nextIteration: number | null;
  improvementEntryPoint: boolean;
  mustContinue: boolean;
  completedFlowThisCall: boolean;
  phase: CreateFlowPhase;
}): string => {
  if (syncRequired) {
    return "Call sync_bank to reconcile the existing project bank before any create or improve flow.";
  }

  if (hasAppliedChanges(applyResults)) {
    if (hasApplyConflicts(applyResults)) {
      return "Some create-flow changes conflicted with the current AI Guidance Bank state. Re-read the affected entries, rebuild the full final documents, and retry create_bank.apply with fresh baseSha256 values.";
    }

    if (stepCompletionRequired && nextIteration !== null) {
      return `Create-flow changes were applied during phase \`${phase}\`. Call create_bank with iteration: ${nextIteration} and stepCompleted: true to finish this step.`;
    }

    if (mustContinue && nextIteration !== null) {
      if (phase === "review_existing_guidance") {
        return `Create-flow changes were applied for the current review batch. Continue the review flow and call create_bank with iteration: ${nextIteration} and stepCompleted: true after the next review batch is complete.`;
      }

      return `Create-flow changes were applied during phase \`${phase}\`. Call create_bank with iteration: ${nextIteration}, stepCompleted: true, and stepOutcome: \`applied\` to continue.`;
    }

    if (completedFlowThisCall) {
      return "Create-flow changes were applied and the flow is complete. Tell the user the project bank is ready.";
    }

    return "Create-flow changes were applied for the current step.";
  }

  if (stepCompletionRequired && nextIteration !== null) {
    return `Finish phase \`${phase}\` before advancing. Call create_bank with iteration: ${nextIteration} and stepCompleted: true when this step is complete.`;
  }

  if (sourceStrategyRequired && nextIteration !== null) {
    const nextBucket = pendingSourceReviewBuckets[0];
    const nextBucketInstruction = nextBucket
      ? ` Resolve the next pending review bucket \`${nextBucket.bucket}\` first.`
      : "";
    return `Finish the current source review before advancing from phase \`${phase}\`.${nextBucketInstruction} Call create_bank with sourceReviewDecision and stepCompleted: true when that review batch is complete.`;
  }

  if (stepOutcomeRequired && nextIteration !== null) {
    if (phase === "finalize") {
      return `Record an explicit outcome for phase \`${phase}\` before advancing. Call create_bank with iteration: ${nextIteration}, stepCompleted: true, and either create_bank.apply changes for this step or stepOutcome: \`applied\` or \`no_changes\`. When using \`no_changes\`, stepOutcomeNote should say what you checked, what you did not add, and why the bank is complete enough.`;
    }

    if (phase === "derive_from_project") {
      return `Record an explicit outcome for phase \`${phase}\` before advancing. Call create_bank with iteration: ${nextIteration}, stepCompleted: true, and either create_bank.apply changes for this step or stepOutcome: \`applied\` or \`no_changes\`. When using \`no_changes\`, stepOutcomeNote should say what you checked, what you did not add, and why.`;
    }

    return `Record an explicit outcome for phase \`${phase}\` before advancing. Call create_bank with iteration: ${nextIteration}, stepCompleted: true, and either create_bank.apply changes for this step or stepOutcome: \`applied\` or \`no_changes\` (with stepOutcomeNote for \`no_changes\`).`;
  }

  if (improvementEntryPoint) {
    return "Project AI Guidance Bank already exists. Ask the user whether to improve it. If they agree, call create_bank with iteration: 1 to start the improve flow.";
  }

  if (mustContinue && nextIteration !== null) {
    const coverageReminder =
      phase === "finalize"
        ? " If no new mutations are needed, use stepOutcomeNote to say what you checked, what you did not add, and why."
        : "";
    return `Continue with phase \`${phase}\`. Call create_bank with iteration: ${nextIteration} and stepCompleted: true after this step is complete. For content phases, also provide either create_bank.apply changes or stepOutcome.${coverageReminder}`;
  }

  if (completedFlowThisCall) {
    return "Create flow complete. Tell the user the project bank is ready.";
  }

  return "Project AI Guidance Bank is ready.";
};
