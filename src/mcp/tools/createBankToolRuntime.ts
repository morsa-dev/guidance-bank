import {
  createProjectBankState,
  markProjectBankSynced,
  setProjectBankCreateIteration,
} from "../../core/bank/project.js";
import type { ProjectBankManifest, ProjectBankState, ProjectCreationState } from "../../core/bank/types.js";
import type { CreateFlowPhase } from "../../core/projects/createFlowPhases.js";
import type { CreateBankApplyResults } from "./createBankApply.js";
import type { CreateBankArgs } from "./createBankToolSchemas.js";

export const shouldWarnAboutIterationMismatch = (
  storedIteration: number | null,
  requestedIteration: number,
  effectiveIteration: number,
  stepCompletionRequired: boolean,
): boolean => {
  if (storedIteration === null) {
    return false;
  }

  if (stepCompletionRequired) {
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
  stepCompletionRequired,
}: {
  hasApply: boolean;
  syncRequired: boolean;
  improvementEntryPoint: boolean;
  stepCompletionRequired: boolean;
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

  if (stepCompletionRequired) {
    return "Cannot apply create-flow changes while step completion is unresolved. Re-call create_bank for the current step before applying changes or advancing.";
  }

  return null;
};

export const resolveNextCreateBankState = ({
  existingManifest,
  existingState,
  shouldTrackCreateFlow,
  nextCreationState,
  manifestStorageVersion,
  effectiveIteration,
}: {
  existingManifest: ProjectBankManifest | null;
  existingState: ProjectBankState | null;
  shouldTrackCreateFlow: boolean;
  nextCreationState: ProjectCreationState;
  manifestStorageVersion: number;
  effectiveIteration: number;
}): ProjectBankState => {
  let nextState = existingState;

  if (existingManifest === null) {
    nextState = markProjectBankSynced(createProjectBankState(nextCreationState), manifestStorageVersion);
  } else if (nextState === null) {
    nextState = createProjectBankState(nextCreationState);
  } else if (shouldTrackCreateFlow) {
    nextState = {
      ...nextState,
      creationState: nextCreationState,
    };
  }

  if (shouldTrackCreateFlow) {
    nextState = setProjectBankCreateIteration(nextState, effectiveIteration);
  }

  return nextState;
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
  nextIteration,
  improvementEntryPoint,
  mustContinue,
  completedFlowThisCall,
  phase,
}: {
  syncRequired: boolean;
  applyResults: CreateBankApplyResults;
  stepCompletionRequired: boolean;
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
      return `Create-flow changes were applied during phase \`${phase}\`. Use \`phase\` as the primary guide and treat \`iteration\` as diagnostic only. Re-call create_bank with iteration: ${nextIteration} and stepCompleted: true once the current step is complete.`;
    }

    if (completedFlowThisCall) {
      return "Create-flow changes were applied and the flow is complete. Tell the user the project bank is ready.";
    }

    return "Create-flow changes were applied for the current step.";
  }

  if (stepCompletionRequired && nextIteration !== null) {
    return `Mark the current create step complete before advancing from phase \`${phase}\`. Use \`phase\` as the primary guide and treat \`iteration\` as diagnostic only. Re-call create_bank with iteration: ${nextIteration} and stepCompleted: true once the current step is actually done.`;
  }

  if (improvementEntryPoint) {
    return "Project Memory Bank already exists. Ask the user whether to improve it. If they agree, continue with phase `review_existing_guidance` by calling create_bank with iteration: 1. Use `phase` as the primary guide and treat `iteration` as diagnostic only.";
  }

  if (mustContinue && nextIteration !== null) {
    return `Continue the create flow at phase \`${phase}\`. Use \`phase\` as the primary guide, treat \`iteration\` as diagnostic only, and prefer \`create_bank.apply\` for writes inside the guided flow. Call create_bank with iteration: ${nextIteration} and stepCompleted: true after the current step is complete.`;
  }

  if (completedFlowThisCall) {
    return "Create flow complete. Tell the user the project bank is ready.";
  }

  return "Project Memory Bank is ready.";
};
