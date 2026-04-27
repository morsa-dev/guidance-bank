import { buildCreateBankPrompt } from "../../../core/projects/create-flow/createBankPrompt.js";
import {
  buildCreateBankIterationPrompt,
  buildReadyProjectBankPrompt,
} from "../../../core/projects/create-flow/createBankIterationPrompt.js";
import type { CreateFlowPhase } from "../../../core/projects/create-flow/createFlowPhases.js";
import type { ResolvedCreateBankFlowContext } from "../../../core/projects/create-flow/createBankFlow.js";
import type { ConfirmedGuidanceSourceStrategy } from "../../../core/projects/create-flow/guidanceStrategies.js";
import { REPOSITORY_LOCAL_DISCOVERY_REF, type PendingSourceReviewBucket } from "../../../core/projects/create-flow/sourceReviewBuckets.js";
import { buildCreateBankResponseText } from "./runtime.js";
import type { CreateBankApplyResults } from "./apply.js";

type FinalizedCreateBankExecution = {
  effectiveIteration: number;
  phase: CreateFlowPhase;
  stepCompletionRequired: boolean;
  stepOutcomeRequired: boolean;
  mustContinue: boolean;
  nextIteration: number | null;
  completedFlowThisCall: boolean;
  confirmedSourceStrategies: ConfirmedGuidanceSourceStrategy[];
  pendingSourceReviewBuckets: PendingSourceReviewBucket[];
  nextState: {
    creationState: "unknown" | "postponed" | "declined" | "creating" | "ready";
  };
};

const getCurrentSourceReview = ({
  phase,
  pendingSourceReviewBuckets,
}: {
  phase: CreateFlowPhase;
  pendingSourceReviewBuckets: readonly PendingSourceReviewBucket[];
}) => {
  if (phase !== "review_existing_guidance") {
    return null;
  }

  const pendingBucket = pendingSourceReviewBuckets[0] ?? null;
  if (pendingBucket !== null) {
    return {
      bucket: pendingBucket.bucket,
      paths: pendingBucket.paths,
      decisionRequired: true,
    };
  }

  return null;
};

export const buildCreateBankToolPayload = ({
  flowContext,
  finalExecution,
  currentBankSnapshot,
  applyResults,
  paths,
}: {
  flowContext: ResolvedCreateBankFlowContext;
  finalExecution: FinalizedCreateBankExecution;
  currentBankSnapshot: ResolvedCreateBankFlowContext["extendedContext"]["currentBankSnapshot"];
  applyResults: CreateBankApplyResults;
  paths: {
    projectBankPath: string;
    rulesDirectory: string;
    skillsDirectory: string;
  };
}) => {
  const { projectBankPath, rulesDirectory, skillsDirectory } = paths;
  const publicConfirmedSourceStrategies = finalExecution.confirmedSourceStrategies.filter(
    (s) => s.sourceRef !== REPOSITORY_LOCAL_DISCOVERY_REF,
  );
  const sourceReview = getCurrentSourceReview({
    phase: finalExecution.phase,
    pendingSourceReviewBuckets: finalExecution.pendingSourceReviewBuckets,
  });
  const prompt =
    flowContext.syncRequired
      ? "Project AI Guidance Bank already exists for this repository and requires synchronization before reuse. Sync only reconciles the existing bank with the current AI Guidance Bank storage version; it does not create or improve project content. Ask the user whether to synchronize it now or postpone it. After that, call `resolve_context` again."
      : flowContext.improvementEntryPoint
        ? buildReadyProjectBankPrompt({
            updatedAt: flowContext.existingBankUpdatedAt,
            updatedDaysAgo: flowContext.existingBankUpdatedDaysAgo,
          })
        : finalExecution.mustContinue || finalExecution.completedFlowThisCall
          ? buildCreateBankIterationPrompt({
              iteration: finalExecution.effectiveIteration,
              projectName: flowContext.identity.projectName,
              projectPath: flowContext.identity.projectPath,
              projectBankPath,
              rulesDirectory,
              skillsDirectory,
              detectedStacks: flowContext.projectContext.detectedStacks,
              selectedReferenceProjects: flowContext.selectedReferenceProjects,
              pendingSourceReviewBuckets: finalExecution.pendingSourceReviewBuckets,
              discoveredSources: flowContext.extendedContext.discoveredSources,
              currentBankSnapshot,
              hasExistingProjectBank: flowContext.existingManifest !== null,
            })
          : "Project AI Guidance Bank already exists for this repository and is ready.";

  const creationPrompt =
    finalExecution.effectiveIteration === 0
      ? buildCreateBankPrompt({
          projectName: flowContext.identity.projectName,
          projectPath: flowContext.identity.projectPath,
          projectBankPath,
          rulesDirectory,
          skillsDirectory,
          detectedStacks: flowContext.projectContext.detectedStacks,
          selectedReferenceProjects: flowContext.selectedReferenceProjects,
        })
      : null;

  return {
    status: flowContext.existingManifest === null ? "created" : "already_exists",
    syncRequired: flowContext.syncRequired,
    projectId: flowContext.identity.projectId,
    projectName: flowContext.identity.projectName,
    projectPath: flowContext.identity.projectPath,
    projectBankPath,
    rulesDirectory,
    skillsDirectory,
    detectedStacks: flowContext.projectContext.detectedStacks,
    phase: finalExecution.phase,
    iteration: finalExecution.effectiveIteration,
    discoveredSources: flowContext.extendedContext.discoveredSources,
    sourceReview,
    currentBankSnapshot,
    selectedReferenceProjects: flowContext.selectedReferenceProjects,
    creationState: finalExecution.nextState.creationState,
    confirmedSourceStrategies: publicConfirmedSourceStrategies,
    stepCompletionRequired: finalExecution.stepCompletionRequired,
    sourceStrategyRequired: flowContext.sourceStrategyRequired,
    stepOutcomeRequired: finalExecution.stepOutcomeRequired,
    mustContinue: finalExecution.mustContinue,
    nextIteration: finalExecution.nextIteration,
    existingBankUpdatedAt: flowContext.existingBankUpdatedAt,
    existingBankUpdatedDaysAgo: flowContext.existingBankUpdatedDaysAgo,
    applyResults,
    prompt,
    creationPrompt,
    text: buildCreateBankResponseText({
      syncRequired: flowContext.syncRequired,
      applyResults,
      stepCompletionRequired: finalExecution.stepCompletionRequired,
      sourceStrategyRequired: flowContext.sourceStrategyRequired,
      stepOutcomeRequired: finalExecution.stepOutcomeRequired,
      pendingSourceReviewBuckets: finalExecution.pendingSourceReviewBuckets,
      nextIteration: finalExecution.nextIteration,
      improvementEntryPoint: flowContext.improvementEntryPoint,
      mustContinue: finalExecution.mustContinue,
      completedFlowThisCall: finalExecution.completedFlowThisCall,
      phase: finalExecution.phase,
    }),
  } as const;
};
