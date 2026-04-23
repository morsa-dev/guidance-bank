import type { BankRepository } from "../../../storage/bankRepository.js";
import type { ProviderId } from "../../bank/types.js";
import { discoverCurrentProjectBank, type CurrentProjectBankSnapshot } from "../discoverCurrentProjectBank.js";
import { discoverExistingGuidance, type ExistingGuidanceSource } from "../discoverExistingGuidance.js";

export type CreateBankExtendedContext = {
  discoveredSources: ExistingGuidanceSource[];
  providerGlobalKeptExternal: boolean;
  currentBankSnapshot: CurrentProjectBankSnapshot;
};

const EMPTY_EXTENDED_CONTEXT: CreateBankExtendedContext = {
  discoveredSources: [],
  providerGlobalKeptExternal: false,
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

  const discoveredSources = filterSourcesForActiveProviders(allDiscoveredSources, enabledProviders);

  return {
    discoveredSources,
    providerGlobalKeptExternal: externalGuidanceDecisionState.providerGlobal.keepExternal,
    currentBankSnapshot,
  };
};
