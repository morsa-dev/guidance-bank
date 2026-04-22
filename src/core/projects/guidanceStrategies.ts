export const GUIDANCE_SOURCE_STRATEGIES = ["ignore", "copy", "move", "keep_source_fill_gaps", "keep_provider_native"] as const;
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
  scope?: "repository-local" | "provider-project" | "provider-global";
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
    case "keep_provider_native":
      return "keep provider-native source separate";
  }
};

export const buildDefaultSourceStrategies = (
  sources: readonly ExistingGuidanceSourceLike[],
  decision: SourceReviewDecision,
): ConfirmedGuidanceSourceStrategy[] => {
  return sources.map((source) => ({
    sourceRef: source.relativePath,
    strategy:
      source.entryType === "directory"
        ? "ignore"
        : decision === "not_ok"
          ? "keep_provider_native"
          : source.scope === "provider-global"
            ? "copy"
            : "move",
    note:
      source.entryType === "directory"
        ? "Handled as a container while file-level guidance is migrated."
        : decision === "not_ok"
          ? "User chose to keep this provider-native guidance separate from AI Guidance Bank."
          : source.scope === "provider-global"
            ? "Confirmed by the default canonicalization flow: import useful global guidance into shared AI Guidance Bank while keeping the provider-global source in place."
            : "Confirmed by the default canonicalization flow with legacy cleanup allowed.",
  }));
};
