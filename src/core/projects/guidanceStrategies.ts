export const GUIDANCE_SOURCE_STRATEGIES = ["ignore", "copy", "move", "keep_source_fill_gaps"] as const;
export const SOURCE_REVIEW_DECISIONS = ["ok", "not_ok"] as const;

export type GuidanceSourceStrategy = (typeof GUIDANCE_SOURCE_STRATEGIES)[number];
export type SourceReviewDecision = (typeof SOURCE_REVIEW_DECISIONS)[number];

export type ConfirmedGuidanceSourceStrategy = {
  sourceRef: string;
  strategy: GuidanceSourceStrategy;
  note: string | null;
};

export type ExistingGuidanceSourceLike = {
  relativePath: string;
  entryType: "file" | "directory";
};

export const formatGuidanceSourceStrategy = (strategy: GuidanceSourceStrategy): string => {
  switch (strategy) {
    case "ignore":
      return "ignore";
    case "copy":
      return "copy";
    case "move":
      return "move";
    case "keep_source_fill_gaps":
      return "keep source, fill gaps in bank";
  }
};

export const buildDefaultSourceStrategies = (
  sources: readonly ExistingGuidanceSourceLike[],
  decision: SourceReviewDecision,
): ConfirmedGuidanceSourceStrategy[] => {
  if (decision === "not_ok") {
    return sources.map((source) => ({
      sourceRef: source.relativePath,
      strategy: "ignore",
      note: "User chose to keep legacy guidance as-is.",
    }));
  }

  return sources.map((source) => ({
    sourceRef: source.relativePath,
    strategy: source.entryType === "directory" ? "ignore" : "copy",
    note:
      source.entryType === "directory"
        ? "Handled as a container while file-level guidance is migrated."
        : "Confirmed by the default canonicalization flow.",
  }));
};
