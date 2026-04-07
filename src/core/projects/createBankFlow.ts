import type { BankRepository } from "../../storage/bankRepository.js";
import { requiresProjectBankSync, resolveProjectBankLifecycleStatus } from "../bank/lifecycle.js";
import type { ProjectCreationState } from "../bank/types.js";
import { detectProjectContext } from "../context/detectProjectContext.js";
import { getNextCreateFlowIteration, isCreateFlowComplete, requiresCreateFlowStepOutcome } from "./createFlowPhases.js";
import { discoverCurrentProjectBank, type CurrentProjectBankSnapshot } from "./discoverCurrentProjectBank.js";
import { discoverExistingGuidance, type ExistingGuidanceSource } from "./discoverExistingGuidance.js";
import { findReferenceProjects } from "./findReferenceProjects.js";
import {
  buildDefaultSourceStrategies,
  type ConfirmedGuidanceSourceStrategy,
  type SourceReviewDecision,
} from "./guidanceStrategies.js";
import { resolveProjectIdentity } from "./identity.js";

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
};

type ResolvedCreateBankFlowContext = {
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
};

const EMPTY_EXTENDED_CONTEXT: CreateBankExtendedContext = {
  discoveredSources: [],
  currentBankSnapshot: {
    exists: false,
    entries: [],
  },
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

  const [discoveredSources, currentBankSnapshot] = await Promise.all([
    discoverExistingGuidance(projectPath),
    discoverCurrentProjectBank(repository, projectId, hasExistingProjectBank),
  ]);

  return {
    discoveredSources,
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
    existingState?.creationState === "declined";
  const nextCreationState = shouldTrackCreateFlow ? (isFlowComplete ? "ready" : "creating") : "ready";
  const improvementEntryPoint = lifecycleStatus === "ready" && effectiveIteration === 0;
  const mustContinue =
    !syncRequired &&
    (nextCreationState === "creating" ||
      (lifecycleStatus === "ready" && effectiveIteration > 0 && !isFlowComplete));
  const nextIteration = syncRequired
    ? null
    : improvementEntryPoint
      ? 1
      : mustContinue
        ? getNextCreateFlowIteration(effectiveIteration)
        : null;
  const completedFlowThisCall = !mustContinue && existingState?.creationState === "creating" && isFlowComplete;
  const extendedContext = await loadExtendedCreateBankContext(
    repository,
    identity.projectId,
    existingManifest !== null,
    identity.projectPath,
    mustContinue || completedFlowThisCall,
  );

  const knownSourceRefs = new Set(extendedContext.discoveredSources.map((source) => source.relativePath));
  const resolvedSourceStrategies =
    sourceReviewDecision
      ? buildDefaultSourceStrategies(extendedContext.discoveredSources, sourceReviewDecision)
      : existingState?.sourceStrategies ?? [];

  const confirmedSourceStrategies = resolvedSourceStrategies.filter((strategy) => knownSourceRefs.has(strategy.sourceRef));
  const confirmedSourceStrategyRefs = new Set(confirmedSourceStrategies.map((strategy) => strategy.sourceRef));
  const sourceReviewAdvanceRequested =
    (existingState?.createIteration ?? null) === 1 && requestedIteration === 2 && stepCompleted;
  const sourceStrategyRequired =
    !syncRequired &&
    sourceReviewAdvanceRequested &&
    extendedContext.discoveredSources.length > 0 &&
    extendedContext.discoveredSources.some((source) => !confirmedSourceStrategyRefs.has(source.relativePath));

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
  };
};
