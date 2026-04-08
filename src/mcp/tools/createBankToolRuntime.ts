import type { CreateFlowPhase } from "../../core/projects/createFlowPhases.js";
import type { CreateBankApplyResults } from "./createBankApply.js";
import type { CreateBankArgs } from "./createBankToolSchemas.js";

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
  stepCompletionRequired,
  sourceStrategyRequired,
  stepOutcomeRequired,
}: {
  hasApply: boolean;
  syncRequired: boolean;
  improvementEntryPoint: boolean;
  phase: CreateFlowPhase;
  hasDiscoveredSources: boolean;
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
    return "Cannot apply create-flow changes during review_existing_guidance. First confirm the external guidance review decision, then continue into import_selected_guidance.";
  }

  if (phase === "kickoff" && hasDiscoveredSources) {
    return "Cannot apply create-flow changes during kickoff while external guidance sources still need review. Finish the source review first, then continue with import or derive.";
  }

  if (stepCompletionRequired) {
    return "Cannot apply create-flow changes while step completion is unresolved. Re-call create_bank for the current step before applying changes or advancing.";
  }

  if (sourceStrategyRequired) {
    return "Cannot apply create-flow changes until the external guidance review decision is recorded. Re-call create_bank for the review phase with sourceReviewDecision (`ok` or `not_ok`) before importing or applying changes.";
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
      return "Some create-flow changes conflicted with the current Memory Bank state. Re-read the affected entries, rebuild the full final documents, and retry create_bank.apply with fresh baseSha256 values.";
    }

    if (stepCompletionRequired && nextIteration !== null) {
      return `Create-flow changes were applied during phase \`${phase}\`. Mark the current step complete before advancing. Use \`phase\` as the primary guide and treat \`iteration\` as diagnostic only. Re-call create_bank with iteration: ${nextIteration} and stepCompleted: true once the current step is actually done.`;
    }

    if (mustContinue && nextIteration !== null) {
      return `Create-flow changes were applied during phase \`${phase}\`. Use \`phase\` as the primary guide and treat \`iteration\` as diagnostic only. Re-call create_bank with iteration: ${nextIteration}, stepCompleted: true, and stepOutcome: \`applied\` once the current step is complete.`;
    }

    if (completedFlowThisCall) {
      return "Create-flow changes were applied and the flow is complete. Tell the user the project bank is ready.";
    }

    return "Create-flow changes were applied for the current step.";
  }

  if (stepCompletionRequired && nextIteration !== null) {
    return `Mark the current create step complete before advancing from phase \`${phase}\`. Use \`phase\` as the primary guide and treat \`iteration\` as diagnostic only. Re-call create_bank with iteration: ${nextIteration} and stepCompleted: true once the current step is actually done.`;
  }

  if (sourceStrategyRequired && nextIteration !== null) {
    return `Record an external guidance review decision before advancing from phase \`${phase}\`. Use \`phase\` as the primary guide and treat \`iteration\` as diagnostic only. Re-call create_bank with iteration: ${nextIteration}, stepCompleted: true, and either sourceReviewDecision: \`ok\` or \`not_ok\`.`;
  }

  if (stepOutcomeRequired && nextIteration !== null) {
    if (phase === "finalize") {
      return `Record an explicit outcome for phase \`${phase}\` before advancing. Use \`phase\` as the primary guide and treat \`iteration\` as diagnostic only. Re-call create_bank with iteration: ${nextIteration}, stepCompleted: true, and either create_bank.apply changes for this step or set stepOutcome to \`applied\` or \`no_changes\`. When using \`no_changes\` here, stepOutcomeNote should summarize the strongest remaining or skipped high-value candidates and why the bank is already complete enough.`;
    }

    if (phase === "derive_from_project") {
      return `Record an explicit outcome for phase \`${phase}\` before advancing. Use \`phase\` as the primary guide and treat \`iteration\` as diagnostic only. Re-call create_bank with iteration: ${nextIteration}, stepCompleted: true, and either create_bank.apply changes for this step or set stepOutcome to \`applied\` or \`no_changes\`. When using \`no_changes\`, stepOutcomeNote should explain which strongest remaining candidates were reviewed and why they were skipped.`;
    }

    return `Record an explicit outcome for phase \`${phase}\` before advancing. Use \`phase\` as the primary guide and treat \`iteration\` as diagnostic only. Re-call create_bank with iteration: ${nextIteration}, stepCompleted: true, and either create_bank.apply changes for this step or set stepOutcome to \`applied\` or \`no_changes\` (with stepOutcomeNote for \`no_changes\`).`;
  }

  if (improvementEntryPoint) {
    return "Project Memory Bank already exists. Ask the user whether to improve it. If they agree, continue with phase `review_existing_guidance` by calling create_bank with iteration: 1. Use `phase` as the primary guide and treat `iteration` as diagnostic only.";
  }

  if (mustContinue && nextIteration !== null) {
    const coverageReminder =
      phase === "finalize"
        ? " If no new mutations are needed, use stepOutcomeNote to summarize the strongest skipped or already-covered high-value candidates."
        : "";
    return `Continue the create flow at phase \`${phase}\`. Use \`phase\` as the primary guide, treat \`iteration\` as diagnostic only, and prefer \`create_bank.apply\` for writes inside the guided flow. Call create_bank with iteration: ${nextIteration} and stepCompleted: true after the current step is complete. For content phases, also provide an explicit step outcome: use \`create_bank.apply\` for changes or set \`stepOutcome\` when no new mutations are needed.${coverageReminder}`;
  }

  if (completedFlowThisCall) {
    return "Create flow complete. Tell the user the project bank is ready.";
  }

  return "Project Memory Bank is ready.";
};
