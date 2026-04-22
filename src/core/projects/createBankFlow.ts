import type { BankRepository } from "../../storage/bankRepository.js";
import type { ProviderId } from "../bank/types.js";
import { requiresProjectBankSync, resolveProjectBankLifecycleStatus } from "../bank/lifecycle.js";
import {
  createProjectBankState,
  markProjectBankSynced,
  setProjectBankCreateIteration,
  setProjectBankSourceStrategies,
} from "../bank/project.js";
import type { ProjectBankState, ProjectCreationState } from "../bank/types.js";
import {
  createExternalGuidanceSourceKey,
  type ExternalGuidanceDecisionState,
} from "../bank/externalGuidanceDecisions.js";
import { detectProjectContext } from "../context/detectProjectContext.js";
import {
  getCreateFlowPhase,
  getNextCreateFlowIteration,
  isCreateFlowComplete,
  requiresCreateFlowStepOutcome,
} from "./createFlowPhases.js";
import { discoverCurrentProjectBank, type CurrentProjectBankSnapshot } from "./discoverCurrentProjectBank.js";
import { discoverExistingGuidance, type ExistingGuidanceSource } from "./discoverExistingGuidance.js";
import { findReferenceProjects } from "./findReferenceProjects.js";
import {
  type ConfirmedGuidanceSourceStrategy,
  type SourceReviewDecision,
} from "./guidanceStrategies.js";
import { resolveProjectIdentity } from "./identity.js";
import {
  applySourceReviewDecision,
  buildPendingSourceReviewBuckets,
  matchesStoredSourceStrategy,
  type PendingSourceReviewBucket,
  type SourceReviewBucket,
} from "./sourceReviewBuckets.js";

type CreateBankExtendedContext = {
  discoveredSources: ExistingGuidanceSource[];
  currentBankSnapshot: CurrentProjectBankSnapshot;
};

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
  sourceReviewBucket?: SourceReviewBucket;
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
};

type CreateBankApplyOutcome = {
  writes: Array<{ status: "created" | "updated" | "conflict" }>;
  deletions: Array<{ status: "deleted" | "not_found" | "conflict" }>;
};

export const resolveNextCreateBankState = ({
  existingManifest,
  existingState,
  shouldTrackCreateFlow,
  nextCreationState,
  manifestStorageVersion,
  effectiveIteration,
  confirmedSourceStrategies,
}: {
  existingManifest: ResolvedCreateBankFlowContext["existingManifest"];
  existingState: ProjectBankState | null;
  shouldTrackCreateFlow: boolean;
  nextCreationState: ProjectCreationState;
  manifestStorageVersion: number;
  effectiveIteration: number;
  confirmedSourceStrategies: ConfirmedGuidanceSourceStrategy[];
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
    nextState = setProjectBankSourceStrategies(
      nextState,
      nextCreationState === "ready" ? [] : confirmedSourceStrategies,
    );
  }

  return nextState;
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
  const hasAppliedChanges = applyResults.writes.length > 0 || applyResults.deletions.length > 0;
  const hasApplyConflicts =
    applyResults.writes.some((item) => item.status === "conflict") ||
    applyResults.deletions.some((item) => item.status === "conflict");
  const {
    effectiveIteration: resolvedEffectiveIteration,
    stepCompletionRequired,
    stepOutcomeRequired,
  } = resolveCreateFlowProgress({
    storedIteration: flowContext.existingState?.createIteration ?? null,
    requestedIteration,
    stepCompleted,
    stepOutcomeSatisfied:
      (hasAppliedChanges && !hasApplyConflicts) ||
      stepOutcome === "applied" ||
      (stepOutcome === "no_changes" && stepOutcomeNote !== null),
  });
  const effectiveIteration = flowContext.sourceStrategyRequired
    ? flowContext.existingState?.createIteration ?? resolvedEffectiveIteration
    : resolvedEffectiveIteration;
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
    confirmedSourceStrategies: flowContext.confirmedSourceStrategies,
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
  };
};

const EMPTY_EXTENDED_CONTEXT: CreateBankExtendedContext = {
  discoveredSources: [],
  currentBankSnapshot: {
    exists: false,
    entries: [],
  },
};

const ACTIVE_PROVIDER_TO_DISCOVERY_PROVIDER: Partial<Record<ProviderId, NonNullable<ExistingGuidanceSource["provider"]>>> = {
  codex: "codex",
  cursor: "cursor",
  "claude-code": "claude",
};

const filterSourcesForActiveProviders = (
  sources: readonly ExistingGuidanceSource[],
  enabledProviders: readonly ProviderId[],
): ExistingGuidanceSource[] => {
  const activeProviders = new Set(
    enabledProviders.flatMap((providerId) => {
      const mappedProvider = ACTIVE_PROVIDER_TO_DISCOVERY_PROVIDER[providerId];
      return mappedProvider ? [mappedProvider] : [];
    }),
  );

  return sources.filter(
    (source) => source.scope === "repository-local" || source.provider === null || activeProviders.has(source.provider),
  );
};

const isProviderGlobalSourceSuppressed = (
  source: ExistingGuidanceSource,
  decisionState: ExternalGuidanceDecisionState,
): boolean => {
  if (source.scope !== "provider-global" || source.provider === null) {
    return false;
  }

  const sourceKey = createExternalGuidanceSourceKey({
    scope: source.scope,
    provider: source.provider,
    relativePath: source.relativePath,
  });
  const decision = decisionState.sources[sourceKey];

  return decision !== undefined && decision.fingerprint === source.fingerprint;
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

export const resolveCreateFlowProgress = ({
  storedIteration,
  requestedIteration,
  stepCompleted,
  stepOutcomeSatisfied,
}: {
  storedIteration: number | null;
  requestedIteration: number;
  stepCompleted: boolean;
  stepOutcomeSatisfied: boolean;
}): {
  effectiveIteration: number;
  stepCompletionRequired: boolean;
  stepOutcomeRequired: boolean;
} => {
  if (storedIteration === null) {
    return {
      effectiveIteration: requestedIteration,
      stepCompletionRequired: false,
      stepOutcomeRequired: false,
    };
  }

  if (requestedIteration === 0 || requestedIteration <= storedIteration) {
    return {
      effectiveIteration: requestedIteration,
      stepCompletionRequired: false,
      stepOutcomeRequired: false,
    };
  }

  if (requestedIteration === storedIteration + 1) {
    if (stepCompleted && requiresCreateFlowStepOutcome(storedIteration) && !stepOutcomeSatisfied) {
      return {
        effectiveIteration: storedIteration,
        stepCompletionRequired: false,
        stepOutcomeRequired: true,
      };
    }

    return stepCompleted
      ? {
          effectiveIteration: requestedIteration,
          stepCompletionRequired: false,
          stepOutcomeRequired: false,
        }
      : {
          effectiveIteration: storedIteration,
          stepCompletionRequired: true,
          stepOutcomeRequired: false,
        };
  }

  return {
    effectiveIteration: storedIteration,
    stepCompletionRequired: true,
    stepOutcomeRequired: false,
  };
};

const loadExtendedCreateBankContext = async (
  repository: BankRepository,
  enabledProviders: readonly ProviderId[],
  projectId: string,
  hasExistingProjectBank: boolean,
  projectPath: string,
  shouldLoad: boolean,
): Promise<CreateBankExtendedContext> => {
  if (!shouldLoad) {
    return {
      ...EMPTY_EXTENDED_CONTEXT,
      currentBankSnapshot: await discoverCurrentProjectBank(repository, projectId, hasExistingProjectBank),
    };
  }

  const [allDiscoveredSources, currentBankSnapshot, externalGuidanceDecisionState] = await Promise.all([
    discoverExistingGuidance(projectPath),
    discoverCurrentProjectBank(repository, projectId, hasExistingProjectBank),
    repository.readExternalGuidanceDecisionState(),
  ]);

  return {
    discoveredSources: filterSourcesForActiveProviders(
      allDiscoveredSources.filter(
        (source) => !isProviderGlobalSourceSuppressed(source, externalGuidanceDecisionState),
      ),
      enabledProviders,
    ),
    currentBankSnapshot,
  };
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
  sourceReviewBucket,
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
  const extendedContext = await loadExtendedCreateBankContext(
    repository,
    manifest.enabledProviders,
    identity.projectId,
    existingManifest !== null,
    identity.projectPath,
    mustContinue || completedFlowThisCall,
  );

  const storedSourceStrategies =
    (existingState?.sourceStrategies ?? []).filter((strategy) =>
      extendedContext.discoveredSources.some((source) => matchesStoredSourceStrategy(source, strategy)),
    );
  const pendingSourceReviewBucketsBeforeDecision = buildPendingSourceReviewBuckets({
    discoveredSources: extendedContext.discoveredSources,
    confirmedSourceStrategies: storedSourceStrategies,
  });
  const resolvedReviewBucket =
    sourceReviewBucket ??
    (sourceReviewDecision && pendingSourceReviewBucketsBeforeDecision.length === 1
      ? pendingSourceReviewBucketsBeforeDecision[0]?.bucket
      : undefined);
  const resolvedSourceStrategies =
    sourceReviewDecision && resolvedReviewBucket
      ? applySourceReviewDecision({
          existingStrategies: storedSourceStrategies,
          discoveredSources: extendedContext.discoveredSources,
          bucket: resolvedReviewBucket,
          decision: sourceReviewDecision,
        })
      : storedSourceStrategies;

  const confirmedSourceStrategies = resolvedSourceStrategies.filter((strategy) =>
    extendedContext.discoveredSources.some((source) => matchesStoredSourceStrategy(source, strategy)),
  );
  const pendingSourceReviewBuckets = buildPendingSourceReviewBuckets({
    discoveredSources: extendedContext.discoveredSources,
    confirmedSourceStrategies,
  });
  const sourceReviewAdvanceRequested =
    (existingState?.createIteration ?? null) === 1 && requestedIteration === 2 && stepCompleted;
  const sourceStrategyRequired =
    !syncRequired &&
    sourceReviewAdvanceRequested &&
    pendingSourceReviewBuckets.length > 0;

  const adjustedEffectiveIteration = sourceStrategyRequired ? existingState?.createIteration ?? effectiveIteration : effectiveIteration;
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
  };
};
