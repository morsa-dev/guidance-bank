import type { BankRepository } from "../../storage/bankRepository.js";
import { requiresProjectBankSync, resolveProjectBankLifecycleStatus } from "../bank/lifecycle.js";
import type { ProjectCreationState } from "../bank/types.js";
import { detectProjectContext } from "../context/detectProjectContext.js";
import { getNextCreateFlowIteration, isCreateFlowComplete } from "./createBankIterationPrompt.js";
import { discoverExistingGuidance, type ExistingGuidanceSource } from "./discoverExistingGuidance.js";
import { discoverProjectEvidence, type ProjectEvidenceInventory } from "./discoverProjectEvidence.js";
import { discoverRecentCommits, type RecentProjectCommit } from "./discoverRecentCommits.js";
import { findReferenceProjects } from "./findReferenceProjects.js";
import { resolveProjectIdentity } from "./identity.js";

type CreateBankExtendedContext = {
  discoveredSources: ExistingGuidanceSource[];
  projectEvidence: ProjectEvidenceInventory;
  recentCommits: RecentProjectCommit[];
};

type ResolveCreateBankFlowContextOptions = {
  repository: BankRepository;
  projectPath: string;
  requestedIteration: number;
  referenceProjectIds?: string[];
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
  lifecycleStatus: ReturnType<typeof resolveProjectBankLifecycleStatus>;
  shouldTrackCreateFlow: boolean;
  nextCreationState: ProjectCreationState;
  syncRequired: boolean;
  improvementEntryPoint: boolean;
  mustContinue: boolean;
  nextIteration: number | null;
  completedFlowThisCall: boolean;
  extendedContext: CreateBankExtendedContext;
};

const EMPTY_PROJECT_EVIDENCE: ProjectEvidenceInventory = {
  topLevelDirectories: [],
  evidenceFiles: [],
};

const EMPTY_EXTENDED_CONTEXT: CreateBankExtendedContext = {
  discoveredSources: [],
  projectEvidence: EMPTY_PROJECT_EVIDENCE,
  recentCommits: [],
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

const loadExtendedCreateBankContext = async (
  projectPath: string,
  shouldLoad: boolean,
): Promise<CreateBankExtendedContext> => {
  if (!shouldLoad) {
    return EMPTY_EXTENDED_CONTEXT;
  }

  const [discoveredSources, projectEvidence, recentCommits] = await Promise.all([
    discoverExistingGuidance(projectPath),
    discoverProjectEvidence(projectPath),
    discoverRecentCommits(projectPath),
  ]);

  return {
    discoveredSources,
    projectEvidence,
    recentCommits,
  };
};

export const resolveCreateBankFlowContext = async ({
  repository,
  projectPath,
  requestedIteration,
  referenceProjectIds,
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
  const lifecycleStatus = resolveProjectBankLifecycleStatus({
    projectManifest: existingManifest,
    projectState: existingState,
    expectedStorageVersion: manifest.storageVersion,
  });
  const syncRequired = existingManifest === null ? false : requiresProjectBankSync(existingState, manifest.storageVersion);
  const isFlowComplete = isCreateFlowComplete(requestedIteration);
  const shouldTrackCreateFlow =
    existingManifest === null ||
    existingState?.creationState === "creating" ||
    existingState?.creationState === "declined";
  const nextCreationState = shouldTrackCreateFlow ? (isFlowComplete ? "ready" : "creating") : "ready";
  const improvementEntryPoint = lifecycleStatus === "ready" && requestedIteration === 0;
  const mustContinue =
    !syncRequired &&
    (nextCreationState === "creating" ||
      (lifecycleStatus === "ready" && requestedIteration > 0 && !isFlowComplete));
  const nextIteration = syncRequired
    ? null
    : improvementEntryPoint
      ? 1
      : mustContinue
        ? getNextCreateFlowIteration(requestedIteration)
        : null;
  const completedFlowThisCall = !mustContinue && existingState?.creationState === "creating" && isFlowComplete;
  const extendedContext = await loadExtendedCreateBankContext(
    identity.projectPath,
    mustContinue || completedFlowThisCall,
  );

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
    lifecycleStatus,
    shouldTrackCreateFlow,
    nextCreationState,
    syncRequired,
    improvementEntryPoint,
    mustContinue,
    nextIteration,
    completedFlowThisCall,
    extendedContext,
  };
};
