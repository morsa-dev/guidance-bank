import type { SourceReviewBucket } from "./sourceReviewBuckets.js";

export const GUIDANCE_SOURCE_STRATEGIES = ["ignore", "copy", "move", "keep_source_fill_gaps", "keep_provider_native"] as const;
export const SOURCE_REVIEW_DECISIONS = ["migrate", "keep"] as const;

export type GuidanceSourceStrategy = (typeof GUIDANCE_SOURCE_STRATEGIES)[number];
export type SourceReviewDecision = (typeof SOURCE_REVIEW_DECISIONS)[number];

export type ConfirmedGuidanceSourceStrategy = {
  sourceRef: string;
  strategy: GuidanceSourceStrategy;
  note: string | null;
  fingerprint?: string | undefined;
  reviewBucket?: SourceReviewBucket | undefined;
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
