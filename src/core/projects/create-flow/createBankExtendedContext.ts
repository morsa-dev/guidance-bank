import type { BankRepository } from "../../../storage/bankRepository.js";
import type { ProviderId } from "../../bank/types.js";
import {
  createExternalGuidanceSourceKey,
  type ExternalGuidanceDecisionState,
} from "../../bank/externalGuidanceDecisions.js";
import { discoverCurrentProjectBank, type CurrentProjectBankSnapshot } from "../discoverCurrentProjectBank.js";
import { discoverExistingGuidance, type ExistingGuidanceSource } from "../discoverExistingGuidance.js";
import { selectReviewableGuidanceSources } from "./sourceReviewBuckets.js";

export type CreateBankExtendedContext = {
  discoveredSources: ExistingGuidanceSource[];
  reviewSources: ExistingGuidanceSource[];
  currentBankSnapshot: CurrentProjectBankSnapshot;
};

const EMPTY_EXTENDED_CONTEXT: CreateBankExtendedContext = {
  discoveredSources: [],
  reviewSources: [],
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

const isProviderGlobalSourceDecisionCurrent = (
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

const isDescendantOfSuppressedProviderGlobalDirectory = (
  source: ExistingGuidanceSource,
  suppressedProviderGlobalDirectories: readonly ExistingGuidanceSource[],
): boolean => {
  if (source.scope !== "provider-global" || source.provider === null) {
    return false;
  }

  return suppressedProviderGlobalDirectories.some(
    (directorySource) =>
      directorySource.provider === source.provider &&
      source.relativePath.startsWith(`${directorySource.relativePath}/`),
  );
};

const filterSuppressedProviderGlobalSources = (
  sources: readonly ExistingGuidanceSource[],
  decisionState: ExternalGuidanceDecisionState,
): ExistingGuidanceSource[] => {
  const suppressedProviderGlobalDirectories = sources.filter(
    (source) => source.entryType === "directory" && isProviderGlobalSourceDecisionCurrent(source, decisionState),
  );

  return sources.filter(
    (source) =>
      !isProviderGlobalSourceDecisionCurrent(source, decisionState) &&
      !isDescendantOfSuppressedProviderGlobalDirectory(source, suppressedProviderGlobalDirectories),
  );
};

export const loadExtendedCreateBankContext = async ({
  repository,
  enabledProviders,
  projectId,
  hasExistingProjectBank,
  projectPath,
  shouldLoad,
}: {
  repository: BankRepository;
  enabledProviders: readonly ProviderId[];
  projectId: string;
  hasExistingProjectBank: boolean;
  projectPath: string;
  shouldLoad: boolean;
}): Promise<CreateBankExtendedContext> => {
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

  const discoveredSources = filterSourcesForActiveProviders(
    filterSuppressedProviderGlobalSources(allDiscoveredSources, externalGuidanceDecisionState),
    enabledProviders,
  );
  const reviewSources = selectReviewableGuidanceSources(discoveredSources);

  return {
    discoveredSources,
    reviewSources,
    currentBankSnapshot,
  };
};
