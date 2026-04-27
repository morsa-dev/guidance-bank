import type { BankRepository } from "../../../storage/bankRepository.js";
import { requiresProjectBankSync, resolveProjectBankLifecycleStatus } from "../../bank/lifecycle.js";
import type { ProjectCreationState } from "../../bank/types.js";
import { detectProjectContext } from "../../context/detectProjectContext.js";
import {
  getCreateFlowPhase,
  getNextCreateFlowIteration,
  isCreateFlowComplete,
} from "./createFlowPhases.js";
import { findReferenceProjects } from "../findReferenceProjects.js";
import {
  type ConfirmedGuidanceSourceStrategy,
  type SourceReviewDecision,
} from "./guidanceStrategies.js";
import { resolveProjectIdentity } from "../identity.js";
import { loadExtendedCreateBankContext, type CreateBankExtendedContext } from "./createBankExtendedContext.js";
import { resolveCreateBankSourceReviewState } from "./createBankSourceReviewState.js";
import { resolveNextCreateBankState } from "./createBankState.js";
import { resolveCreateFlowProgress } from "./createFlowProgress.js";
import {
  buildPendingSourceReviewBuckets,
  completePendingImportBucket,
  selectSourceReviewSources,
  type PendingSourceReviewBucket,
  type SourceReviewBucket,
} from "./sourceReviewBuckets.js";

type ResolveCreateBankFlowContextOptions = {
  repository: BankRepository;
  projectPath: string;
  requestedIteration: number;
  stepCompleted: boolean;
  hasApply: boolean;
  stepOutcome: "applied" | "no_changes" | null;
  stepOutcomeNote: string | null;
  referenceProjectIds?: string[];
  sourceReviewDecision?: SourceReviewDecision;
};

export type ResolvedCreateBankFlowContext = {
  identity: ReturnType<typeof resolveProjectIdentity>;
  manifestStorageVersion: number;
  projectContext: Awaited<ReturnType<typeof detectProjectContext>>;
  existingManifest: Awaited<ReturnType<BankRepository["readProjectManifestOptional"]>>;
  existingState: Awaited<ReturnType<BankRepository["readProjectStateOptional"]>>;
  selectedReferenceProjects: Awaited<ReturnType<typeof findReferenceProjects>>;
  unknownReferenceIds: string[];
  existingBankUpdatedAt: string | null;
  existingBankUpdatedDaysAgo: number | null;
  effectiveIteration: number;
  stepCompletionRequired: boolean;
  sourceStrategyRequired: boolean;
  stepOutcomeRequired: boolean;
  lifecycleStatus: ReturnType<typeof resolveProjectBankLifecycleStatus>;
  shouldTrackCreateFlow: boolean;
  nextCreationState: ProjectCreationState;
  syncRequired: boolean;
  improvementEntryPoint: boolean;
  mustContinue: boolean;
  nextIteration: number | null;
  completedFlowThisCall: boolean;
  extendedContext: CreateBankExtendedContext;
  confirmedSourceStrategies: ConfirmedGuidanceSourceStrategy[];
  pendingSourceReviewBuckets: PendingSourceReviewBucket[];
  resolvedReviewBucket: SourceReviewBucket | null;
};

type CreateBankApplyOutcome = {
  writes: Array<{ status: "created" | "updated" | "conflict" }>;
  deletions: Array<{ status: "deleted" | "not_found" | "conflict" }>;
};

const hasSuccessfulStepResult = ({
  applyResults,
  stepOutcome,
  stepOutcomeNote,
}: {
  applyResults: CreateBankApplyOutcome;
  stepOutcome: "applied" | "no_changes" | null;
  stepOutcomeNote: string | null;
}): boolean => {
  const hasAppliedChanges = applyResults.writes.length > 0 || applyResults.deletions.length > 0;
  const hasApplyConflicts =
    applyResults.writes.some((item) => item.status === "conflict") ||
    applyResults.deletions.some((item) => item.status === "conflict");

  return (
    (hasAppliedChanges && !hasApplyConflicts) ||
    stepOutcome === "applied" ||
    (stepOutcome === "no_changes" && stepOutcomeNote !== null)
  );
};

export const finalizeCreateBankExecution = ({
  flowContext,
  requestedIteration,
  stepCompleted,
  stepOutcome,
  stepOutcomeNote,
  applyResults,
}: {
  flowContext: ResolvedCreateBankFlowContext;
  requestedIteration: number;
  stepCompleted: boolean;
  stepOutcome: "applied" | "no_changes" | null;
  stepOutcomeNote: string | null;
  applyResults: CreateBankApplyOutcome;
}) => {
  const hasApplyConflicts =
    applyResults.writes.some((item) => item.status === "conflict") ||
    applyResults.deletions.some((item) => item.status === "conflict");
  const successfulStepResult = hasSuccessfulStepResult({
    applyResults,
    stepOutcome,
    stepOutcomeNote,
  });
  const {
    effectiveIteration: resolvedEffectiveIteration,
    stepCompletionRequired,
    stepOutcomeRequired,
  } = resolveCreateFlowProgress({
    storedIteration: flowContext.existingState?.createIteration ?? null,
    requestedIteration,
    stepCompleted,
    stepOutcomeSatisfied: successfulStepResult,
  });
  const previousPhase = getCreateFlowPhase(flowContext.existingState?.createIteration ?? flowContext.effectiveIteration);
  const resolvedReviewStrategies =
    flowContext.resolvedReviewBucket === null
      ? []
      : flowContext.confirmedSourceStrategies.filter(
          (strategy) => strategy.reviewBucket === flowContext.resolvedReviewBucket,
        );
  const resolvedReviewDecision = resolvedReviewStrategies[0]?.decision ?? null;
  const isReviewPhaseCompletion =
    previousPhase === "review_existing_guidance" &&
    stepCompleted &&
    flowContext.resolvedReviewBucket !== null;
  const importedCurrentReviewBucket =
    isReviewPhaseCompletion &&
    resolvedReviewDecision === "import_to_bank" &&
    successfulStepResult;
  const failedCurrentReviewImport =
    isReviewPhaseCompletion &&
    resolvedReviewDecision === "import_to_bank" &&
    !successfulStepResult;
  const keptCurrentReviewBucketExternal =
    isReviewPhaseCompletion && resolvedReviewDecision === "keep_external";
  const completedReviewBucket =
    importedCurrentReviewBucket || keptCurrentReviewBucketExternal
      ? flowContext.resolvedReviewBucket
      : null;
  const retainedSourceStrategies = failedCurrentReviewImport
    ? (flowContext.existingState?.sourceStrategies ?? [])
    : flowContext.confirmedSourceStrategies;
  const confirmedSourceStrategies =
    importedCurrentReviewBucket && flowContext.resolvedReviewBucket !== null
      ? completePendingImportBucket(retainedSourceStrategies, flowContext.resolvedReviewBucket)
      : retainedSourceStrategies;
  const completedReviewBatch = completedReviewBucket !== null;
  const pendingSourceReviewBuckets =
    completedReviewBatch || failedCurrentReviewImport
      ? buildPendingSourceReviewBuckets({
          discoveredSources: selectSourceReviewSources(
            flowContext.extendedContext.discoveredSources,
            flowContext.extendedContext.providerGlobalKeptExternal,
          ),
          confirmedSourceStrategies,
          isImprovementFlow: false,
        })
      : flowContext.pendingSourceReviewBuckets;
  const baseEffectiveIteration = hasApplyConflicts ? resolvedEffectiveIteration : flowContext.effectiveIteration;
  const effectiveIteration = failedCurrentReviewImport
    ? (flowContext.existingState?.createIteration ?? resolvedEffectiveIteration)
    : completedReviewBatch
      ? pendingSourceReviewBuckets.length > 0
        ? 1
        : 2
      : flowContext.sourceStrategyRequired
        ? flowContext.existingState?.createIteration ?? resolvedEffectiveIteration
        : baseEffectiveIteration;
  const phase = flowContext.syncRequired
    ? "sync_required"
    : flowContext.improvementEntryPoint
      ? "ready_to_improve"
      : getCreateFlowPhase(effectiveIteration);
  const isFlowComplete = isCreateFlowComplete(effectiveIteration);
  const nextCreationState = flowContext.shouldTrackCreateFlow
    ? (isFlowComplete ? "ready" : "creating")
    : "ready";
  const mustContinue =
    !flowContext.syncRequired &&
    (nextCreationState === "creating" ||
      (flowContext.lifecycleStatus === "ready" && effectiveIteration > 0 && !isFlowComplete));
  const nextIteration = flowContext.syncRequired
    ? null
    : flowContext.improvementEntryPoint
      ? 1
      : mustContinue
        ? getNextCreateFlowIteration(effectiveIteration)
        : null;
  const completedFlowThisCall =
    !mustContinue && flowContext.existingState?.creationState === "creating" && isFlowComplete;
  const nextState = resolveNextCreateBankState({
    existingManifest: flowContext.existingManifest,
    existingState: flowContext.existingState,
    shouldTrackCreateFlow: flowContext.shouldTrackCreateFlow,
    nextCreationState,
    manifestStorageVersion: flowContext.manifestStorageVersion,
    effectiveIteration,
    confirmedSourceStrategies,
  });

  return {
    effectiveIteration,
    phase,
    stepCompletionRequired,
    stepOutcomeRequired,
    nextCreationState,
    mustContinue,
    nextIteration,
    completedFlowThisCall,
    nextState,
    confirmedSourceStrategies,
    pendingSourceReviewBuckets,
  };
};

const getUpdatedDaysAgo = (updatedAt: string | null, now = new Date()): number | null => {
  if (updatedAt === null) {
    return null;
  }

  const updatedAtTime = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedAtTime)) {
    return null;
  }

  const diffMs = Math.max(0, now.getTime() - updatedAtTime);
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
};

export const resolveCreateBankFlowContext = async ({
  repository,
  projectPath,
  requestedIteration,
  stepCompleted,
  hasApply,
  stepOutcome,
  stepOutcomeNote,
  referenceProjectIds,
  sourceReviewDecision,
}: ResolveCreateBankFlowContextOptions): Promise<ResolvedCreateBankFlowContext> => {
  const identity = resolveProjectIdentity(projectPath);
  const [manifest, projectContext, existingManifest, existingState] = await Promise.all([
    repository.readManifest(),
    detectProjectContext(identity.projectPath),
    repository.readProjectManifestOptional(identity.projectId),
    repository.readProjectStateOptional(identity.projectId),
  ]);

  const referenceProjects = await findReferenceProjects({
    repository,
    currentProjectId: identity.projectId,
    detectedStacks: projectContext.detectedStacks,
  });
  const unknownReferenceIds =
    referenceProjectIds?.filter(
      (referenceProjectId) => !referenceProjects.some((project) => project.projectId === referenceProjectId),
    ) ?? [];

  const selectedReferenceProjects = referenceProjectIds
    ? referenceProjects.filter((project) => referenceProjectIds.includes(project.projectId))
    : [];

  const existingBankUpdatedAt = existingManifest?.updatedAt ?? null;
  const existingBankUpdatedDaysAgo = getUpdatedDaysAgo(existingBankUpdatedAt);
  const { effectiveIteration, stepCompletionRequired, stepOutcomeRequired } = resolveCreateFlowProgress({
    storedIteration: existingState?.createIteration ?? null,
    requestedIteration,
    stepCompleted,
    stepOutcomeSatisfied:
      hasApply || stepOutcome === "applied" || (stepOutcome === "no_changes" && stepOutcomeNote !== null),
  });
  const lifecycleStatus = resolveProjectBankLifecycleStatus({
    projectManifest: existingManifest,
    projectState: existingState,
    expectedStorageVersion: manifest.storageVersion,
  });
  const syncRequired = existingManifest === null ? false : requiresProjectBankSync(existingState, manifest.storageVersion);
  const isFlowComplete = isCreateFlowComplete(effectiveIteration);
  const shouldTrackCreateFlow =
    existingManifest === null ||
    existingState?.creationState === "creating" ||
    existingState?.creationState === "declined" ||
    requestedIteration > 0;
  const nextCreationState = shouldTrackCreateFlow ? (isFlowComplete ? "ready" : "creating") : "ready";
  const improvementEntryPoint = lifecycleStatus === "ready" && effectiveIteration === 0;
  const mustContinue =
    !syncRequired &&
    (nextCreationState === "creating" ||
      (lifecycleStatus === "ready" && effectiveIteration > 0 && !isFlowComplete));
  const completedFlowThisCall = !mustContinue && existingState?.creationState === "creating" && isFlowComplete;
  const extendedContext = await loadExtendedCreateBankContext({
    repository,
    enabledProviders: manifest.enabledProviders,
    projectId: identity.projectId,
    hasExistingProjectBank: existingManifest !== null,
    projectPath: identity.projectPath,
    shouldLoad: mustContinue || completedFlowThisCall,
  });

  const {
    confirmedSourceStrategies,
    pendingSourceReviewBuckets,
    resolvedReviewBucket,
    sourceStrategyRequired,
  } = resolveCreateBankSourceReviewState({
    existingState,
    discoveredSources: extendedContext.discoveredSources,
    providerGlobalKeptExternal: extendedContext.providerGlobalKeptExternal,
    syncRequired,
    requestedIteration,
    stepCompleted,
    sourceReviewDecision,
  });
  const sourceReviewAdvanceRequested =
    (existingState?.createIteration ?? null) === 1 && requestedIteration === 2 && stepCompleted;

  const shouldSkipExternalGuidanceReview =
    effectiveIteration === 1 && pendingSourceReviewBuckets.length === 0;
  const shouldSkipImportAfterReview =
    sourceReviewAdvanceRequested && pendingSourceReviewBuckets.length === 0;
  const adjustedEffectiveIteration =
    shouldSkipExternalGuidanceReview || shouldSkipImportAfterReview
      ? 2
      : sourceStrategyRequired
        ? existingState?.createIteration ?? effectiveIteration
        : effectiveIteration;
  const adjustedIsFlowComplete = isCreateFlowComplete(adjustedEffectiveIteration);
  const adjustedMustContinue =
    !syncRequired &&
    (nextCreationState === "creating" ||
      (lifecycleStatus === "ready" && adjustedEffectiveIteration > 0 && !adjustedIsFlowComplete));
  const adjustedNextIteration = syncRequired
    ? null
    : improvementEntryPoint
      ? 1
      : adjustedMustContinue
        ? getNextCreateFlowIteration(adjustedEffectiveIteration)
        : null;
  const adjustedCompletedFlowThisCall =
    !adjustedMustContinue && existingState?.creationState === "creating" && adjustedIsFlowComplete;

  return {
    identity,
    manifestStorageVersion: manifest.storageVersion,
    projectContext,
    existingManifest,
    existingState,
    selectedReferenceProjects,
    unknownReferenceIds,
    existingBankUpdatedAt,
    existingBankUpdatedDaysAgo,
    effectiveIteration: adjustedEffectiveIteration,
    stepCompletionRequired,
    sourceStrategyRequired,
    stepOutcomeRequired,
    lifecycleStatus,
    shouldTrackCreateFlow,
    nextCreationState,
    syncRequired,
    improvementEntryPoint,
    mustContinue: adjustedMustContinue,
    nextIteration: adjustedNextIteration,
    completedFlowThisCall: adjustedCompletedFlowThisCall,
    extendedContext,
    confirmedSourceStrategies,
    pendingSourceReviewBuckets,
    resolvedReviewBucket,
  };
};
