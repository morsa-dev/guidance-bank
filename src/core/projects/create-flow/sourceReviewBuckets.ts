import type { ExistingGuidanceSource } from "../discoverExistingGuidance.js";
import type { ConfirmedGuidanceSourceStrategy, SourceReviewDecision } from "./guidanceStrategies.js";

export const SOURCE_REVIEW_BUCKETS = ["provider-global", "provider-project", "repository-local"] as const;
export type SourceReviewBucket = (typeof SOURCE_REVIEW_BUCKETS)[number];

export type PendingSourceReviewBucket = {
  bucket: SourceReviewBucket;
  title: string;
  promptLabel: string;
  sources: Array<{
    sourceRef: string;
    entryType: ExistingGuidanceSource["entryType"];
    provider: ExistingGuidanceSource["provider"];
    kind: ExistingGuidanceSource["kind"];
    path: string;
  }>;
  providers: Array<NonNullable<ExistingGuidanceSource["provider"]>>;
  sourceCount: number;
  fileCount: number;
  directoryCount: number;
};

const BUCKET_METADATA: Record<SourceReviewBucket, { title: string; promptLabel: string }> = {
  "repository-local": {
    title: "Repository-local guidance",
    promptLabel: "project-local guidance files and folders in this repository",
  },
  "provider-project": {
    title: "Provider project guidance",
    promptLabel: "provider-managed project guidance for this repository",
  },
  "provider-global": {
    title: "Provider global guidance",
    promptLabel: "user-level provider guidance that can affect this project",
  },
};

const createStrategyNote = (source: ExistingGuidanceSource, decision: SourceReviewDecision): string => {
  if (decision === "keep_external") {
    return source.scope === "provider-global"
      ? "Keep this provider-global guidance separate from AI Guidance Bank and leave the source in place."
      : "Do not import guidance from this source and leave the legacy source in place.";
  }

  if (source.scope === "provider-global") {
    return "Import useful provider-independent guidance into shared AI Guidance Bank while keeping the provider-global source in place.";
  }

  return "Import useful non-duplicate guidance into AI Guidance Bank and allow cleanup of the legacy source only after the agent verifies it was fully replaced.";
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

    const strategy =
      decision === "keep_external"
        ? source.scope === "provider-global"
          ? "keep_provider_native"
          : "ignore"
        : source.scope === "provider-global"
          ? "copy"
          : "keep_source_fill_gaps";

    nextStrategies.set(source.relativePath, {
      sourceRef: source.relativePath,
      strategy,
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

    const providers = [...new Set(unresolvedSources.flatMap((source) => (source.provider ? [source.provider] : [])))];
    const metadata = BUCKET_METADATA[bucket];
    const sources = unresolvedSources.map((source) => ({
      sourceRef: source.relativePath,
      entryType: source.entryType,
      provider: source.provider,
      kind: source.kind,
      path: source.path,
    }));

    return [
      {
        bucket,
        title: metadata.title,
        promptLabel: metadata.promptLabel,
        sources,
        providers,
        sourceCount: unresolvedSources.length,
        fileCount: unresolvedSources.filter((source) => source.entryType === "file").length,
        directoryCount: unresolvedSources.filter((source) => source.entryType === "directory").length,
      },
    ];
  });
};
