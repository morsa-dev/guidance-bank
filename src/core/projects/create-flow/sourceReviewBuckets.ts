import type { ExistingGuidanceSource } from "../discoverExistingGuidance.js";
import type { ConfirmedGuidanceSourceStrategy, SourceReviewDecision } from "./guidanceStrategies.js";

export const SOURCE_REVIEW_BUCKETS = ["repository-local", "provider-project", "provider-global"] as const;
export type SourceReviewBucket = (typeof SOURCE_REVIEW_BUCKETS)[number];

export type PendingSourceReviewBucket = {
  bucket: SourceReviewBucket;
  title: string;
  promptLabel: string;
  sources: string[];
  providers: Array<NonNullable<ExistingGuidanceSource["provider"]>>;
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
  if (source.entryType === "directory") {
    return "Handled as a container while file-level guidance is reviewed.";
  }

  if (decision === "keep") {
    return source.scope === "provider-global"
      ? "Keep this provider-global guidance separate from AI Guidance Bank and leave the source in place."
      : "Do not import guidance from this source and leave the legacy source in place.";
  }

  if (source.scope === "provider-global") {
    return "Import useful provider-independent guidance into shared AI Guidance Bank while keeping the provider-global source in place.";
  }

  return "Import useful non-duplicate guidance into AI Guidance Bank and allow cleanup of the legacy source after successful migration.";
};

export const sourceReviewBucketFor = (source: ExistingGuidanceSource): SourceReviewBucket => source.scope;

export const matchesStoredSourceStrategy = (
  source: ExistingGuidanceSource,
  strategy: ConfirmedGuidanceSourceStrategy,
): boolean =>
  strategy.sourceRef === source.relativePath &&
  strategy.reviewBucket === sourceReviewBucketFor(source) &&
  strategy.fingerprint === source.fingerprint;

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
      source.entryType === "directory"
        ? "ignore"
        : decision === "keep"
          ? source.scope === "provider-global"
            ? "keep_provider_native"
            : "ignore"
          : source.scope === "provider-global"
            ? "copy"
            : "move";

    nextStrategies.set(source.relativePath, {
      sourceRef: source.relativePath,
      strategy,
      note: createStrategyNote(source, decision),
      fingerprint: source.fingerprint,
      reviewBucket: bucket,
    });
  }

  return [...nextStrategies.values()];
};

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

    return [
      {
        bucket,
        title: metadata.title,
        promptLabel: metadata.promptLabel,
        sources: unresolvedSources.map((source) => source.relativePath),
        providers,
      },
    ];
  });
};
