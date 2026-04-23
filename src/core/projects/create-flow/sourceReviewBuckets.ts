import type { ExistingGuidanceSource } from "../discoverExistingGuidance.js";
import type { ConfirmedGuidanceSourceStrategy, SourceReviewDecision } from "./guidanceStrategies.js";

export const SOURCE_REVIEW_BUCKETS = ["provider-global", "provider-project", "repository-local"] as const;
export type SourceReviewBucket = (typeof SOURCE_REVIEW_BUCKETS)[number];

export type PendingSourceReviewBucket = {
  bucket: SourceReviewBucket;
  paths: string[];
};

const createStrategyNote = (source: ExistingGuidanceSource, decision: SourceReviewDecision): string => {
  if (decision === "keep_external") {
    return source.scope === "provider-global"
      ? "Keep this provider-global guidance separate from AI Guidance Bank and leave the source in place."
      : "Do not import guidance from this source and leave the legacy source in place.";
  }

  if (source.scope === "provider-global") {
    return "Move useful provider-independent guidance into shared AI Guidance Bank and remove each migrated guidance item from the provider-global source immediately after the verified bank write.";
  }

  return "Move useful non-duplicate guidance into AI Guidance Bank and remove each migrated guidance item from the source immediately after the verified bank write.";
};

export const sourceReviewBucketFor = (source: ExistingGuidanceSource): SourceReviewBucket => source.scope;

export const matchesStoredSourceStrategy = (
  source: ExistingGuidanceSource,
  strategy: ConfirmedGuidanceSourceStrategy,
): boolean =>
  strategy.sourceRef === source.relativePath &&
  strategy.reviewBucket === sourceReviewBucketFor(source) &&
  strategy.fingerprint === source.fingerprint;

const isDescendantOf = (source: ExistingGuidanceSource, parent: ExistingGuidanceSource): boolean =>
  source.relativePath.startsWith(`${parent.relativePath}/`);

export const sortSourceReviewStrategies = (
  items: readonly ConfirmedGuidanceSourceStrategy[],
): ConfirmedGuidanceSourceStrategy[] =>
  [...items].sort(
    (left, right) =>
      SOURCE_REVIEW_BUCKETS.indexOf(left.reviewBucket ?? "repository-local") -
      SOURCE_REVIEW_BUCKETS.indexOf(right.reviewBucket ?? "repository-local"),
  );

export const selectReviewableGuidanceSources = (
  discoveredSources: readonly ExistingGuidanceSource[],
): ExistingGuidanceSource[] => {
  const directorySources = discoveredSources.filter((source) => source.entryType === "directory");

  return discoveredSources.filter((source) => {
    if (source.entryType === "directory") {
      return true;
    }

    return !directorySources.some(
      (directorySource) =>
        directorySource.scope === source.scope &&
        directorySource.provider === source.provider &&
        isDescendantOf(source, directorySource),
    );
  });
};

export const selectSourceReviewSources = (
  discoveredSources: readonly ExistingGuidanceSource[],
  providerGlobalKeptExternal: boolean,
): ExistingGuidanceSource[] =>
  selectReviewableGuidanceSources(
    providerGlobalKeptExternal
      ? discoveredSources.filter((source) => source.scope !== "provider-global")
      : discoveredSources,
  );

export const applySourceReviewDecision = ({
  existingStrategies,
  discoveredSources,
  bucket,
  decision,
}: {
  existingStrategies: readonly ConfirmedGuidanceSourceStrategy[];
  discoveredSources: readonly ExistingGuidanceSource[];
  bucket: SourceReviewBucket;
  decision: SourceReviewDecision;
}): ConfirmedGuidanceSourceStrategy[] => {
  const nextStrategies = new Map<string, ConfirmedGuidanceSourceStrategy>(
    existingStrategies.map((strategy) => [strategy.sourceRef, strategy]),
  );

  for (const source of discoveredSources) {
    if (sourceReviewBucketFor(source) !== bucket) {
      continue;
    }

    nextStrategies.set(source.relativePath, {
      sourceRef: source.relativePath,
      decision,
      cleanupAllowed: decision === "import_to_bank",
      note: createStrategyNote(source, decision),
      fingerprint: source.fingerprint,
      reviewBucket: bucket,
      importStatus: decision === "keep_external" ? "completed" : "pending",
    });
  }

  return [...nextStrategies.values()];
};

export const getPendingImportBucket = (
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[],
): SourceReviewBucket | null =>
  sortSourceReviewStrategies(confirmedSourceStrategies).find((strategy) => strategy.importStatus === "pending")
    ?.reviewBucket ?? null;

export const completePendingImportBucket = (
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[],
  bucket: SourceReviewBucket,
): ConfirmedGuidanceSourceStrategy[] =>
  confirmedSourceStrategies.map((strategy) =>
    strategy.reviewBucket === bucket && strategy.importStatus === "pending"
      ? {
          ...strategy,
          importStatus: "completed",
        }
      : strategy,
  );

export const buildPendingSourceReviewBuckets = ({
  discoveredSources,
  confirmedSourceStrategies,
}: {
  discoveredSources: readonly ExistingGuidanceSource[];
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[];
}): PendingSourceReviewBucket[] => {
  return SOURCE_REVIEW_BUCKETS.flatMap((bucket) => {
    const bucketSources = discoveredSources.filter((source) => sourceReviewBucketFor(source) === bucket);
    if (bucketSources.length === 0) {
      return [];
    }

    const unresolvedSources = bucketSources.filter(
      (source) => !confirmedSourceStrategies.some((strategy) => matchesStoredSourceStrategy(source, strategy)),
    );

    if (unresolvedSources.length === 0) {
      return [];
    }

    return [
      {
        bucket,
        paths: unresolvedSources.map((source) => source.path),
      },
    ];
  });
};
