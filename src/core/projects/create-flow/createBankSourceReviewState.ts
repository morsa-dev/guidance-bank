import type { ProjectBankState } from "../../bank/types.js";
import type { ExistingGuidanceSource } from "../discoverExistingGuidance.js";
import type { ConfirmedGuidanceSourceStrategy, SourceReviewDecision } from "./guidanceStrategies.js";
import {
  applySourceReviewDecision,
  buildPendingSourceReviewBuckets,
  getPendingImportBucket,
  matchesStoredSourceStrategy,
  REPOSITORY_LOCAL_DISCOVERY_REF,
  selectSourceReviewSources,
  type PendingSourceReviewBucket,
  type SourceReviewBucket,
} from "./sourceReviewBuckets.js";

export type CreateBankSourceReviewState = {
  confirmedSourceStrategies: ConfirmedGuidanceSourceStrategy[];
  pendingSourceReviewBuckets: PendingSourceReviewBucket[];
  activeImportBucket: SourceReviewBucket | null;
  resolvedReviewBucket: SourceReviewBucket | null;
  sourceStrategyRequired: boolean;
};

export const resolveCreateBankSourceReviewState = ({
  existingState,
  discoveredSources,
  providerGlobalKeptExternal,
  syncRequired,
  requestedIteration,
  stepCompleted,
  sourceReviewDecision,
}: {
  existingState: ProjectBankState | null;
  discoveredSources: readonly ExistingGuidanceSource[];
  providerGlobalKeptExternal: boolean;
  syncRequired: boolean;
  requestedIteration: number;
  stepCompleted: boolean;
  sourceReviewDecision: SourceReviewDecision | undefined;
}): CreateBankSourceReviewState => {
  const sources = selectSourceReviewSources(discoveredSources, providerGlobalKeptExternal);
  const storedSourceStrategies =
    (existingState?.sourceStrategies ?? []).filter((strategy) =>
      strategy.sourceRef === REPOSITORY_LOCAL_DISCOVERY_REF ||
      sources.some((source) => matchesStoredSourceStrategy(source, strategy)),
    );
  const isImprovementFlow = existingState?.creationState === "ready";
  const pendingSourceReviewBucketsBeforeDecision = buildPendingSourceReviewBuckets({
    discoveredSources: sources,
    confirmedSourceStrategies: storedSourceStrategies,
    isImprovementFlow,
  });
  const resolvedReviewBucket =
    sourceReviewDecision ? pendingSourceReviewBucketsBeforeDecision[0]?.bucket : undefined;
  const resolvedSourceStrategies =
    sourceReviewDecision && resolvedReviewBucket
      ? applySourceReviewDecision({
          existingStrategies: storedSourceStrategies,
          discoveredSources: sources,
          bucket: resolvedReviewBucket,
          decision: sourceReviewDecision,
        })
      : storedSourceStrategies;

  const confirmedSourceStrategies = resolvedSourceStrategies.filter((strategy) =>
    strategy.sourceRef === REPOSITORY_LOCAL_DISCOVERY_REF ||
    sources.some((source) => matchesStoredSourceStrategy(source, strategy)),
  );
  const pendingSourceReviewBuckets = buildPendingSourceReviewBuckets({
    discoveredSources: sources,
    confirmedSourceStrategies,
    isImprovementFlow,
  });
  const activeImportBucket = getPendingImportBucket(confirmedSourceStrategies);
  const sourceReviewAdvanceRequested =
    (existingState?.createIteration ?? null) === 1 && requestedIteration === 2 && stepCompleted;
  const sourceStrategyRequired =
    !syncRequired &&
    sourceReviewAdvanceRequested &&
    activeImportBucket === null &&
    pendingSourceReviewBuckets.length > 0;

  return {
    confirmedSourceStrategies,
    pendingSourceReviewBuckets,
    activeImportBucket,
    resolvedReviewBucket: resolvedReviewBucket ?? null,
    sourceStrategyRequired,
  };
};
