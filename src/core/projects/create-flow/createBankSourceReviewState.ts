import type { ProjectBankState } from "../../bank/types.js";
import type { ExistingGuidanceSource } from "../discoverExistingGuidance.js";
import type { ConfirmedGuidanceSourceStrategy, SourceReviewDecision } from "./guidanceStrategies.js";
import {
  applySourceReviewDecision,
  buildPendingSourceReviewBuckets,
  getPendingImportBucket,
  matchesStoredSourceStrategy,
  type PendingSourceReviewBucket,
  type SourceReviewBucket,
} from "./sourceReviewBuckets.js";

export type CreateBankSourceReviewState = {
  confirmedSourceStrategies: ConfirmedGuidanceSourceStrategy[];
  pendingSourceReviewBuckets: PendingSourceReviewBucket[];
  activeImportBucket: SourceReviewBucket | null;
  sourceStrategyRequired: boolean;
};

export const resolveCreateBankSourceReviewState = ({
  existingState,
  reviewSources,
  syncRequired,
  requestedIteration,
  stepCompleted,
  sourceReviewDecision,
  sourceReviewBucket,
}: {
  existingState: ProjectBankState | null;
  reviewSources: readonly ExistingGuidanceSource[];
  syncRequired: boolean;
  requestedIteration: number;
  stepCompleted: boolean;
  sourceReviewDecision: SourceReviewDecision | undefined;
  sourceReviewBucket: SourceReviewBucket | undefined;
}): CreateBankSourceReviewState => {
  const storedSourceStrategies =
    (existingState?.sourceStrategies ?? []).filter((strategy) =>
      reviewSources.some((source) => matchesStoredSourceStrategy(source, strategy)),
    );
  const pendingSourceReviewBucketsBeforeDecision = buildPendingSourceReviewBuckets({
    discoveredSources: reviewSources,
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
          discoveredSources: reviewSources,
          bucket: resolvedReviewBucket,
          decision: sourceReviewDecision,
        })
      : storedSourceStrategies;

  const confirmedSourceStrategies = resolvedSourceStrategies.filter((strategy) =>
    reviewSources.some((source) => matchesStoredSourceStrategy(source, strategy)),
  );
  const pendingSourceReviewBuckets = buildPendingSourceReviewBuckets({
    discoveredSources: reviewSources,
    confirmedSourceStrategies,
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
    sourceStrategyRequired,
  };
};
