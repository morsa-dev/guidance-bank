import type { SourceReviewBucket } from "./sourceReviewBuckets.js";

export const SOURCE_REVIEW_DECISIONS = ["import_to_bank", "keep_external"] as const;
export const GUIDANCE_SOURCE_IMPORT_STATUSES = ["pending", "completed"] as const;

export type SourceReviewDecision = (typeof SOURCE_REVIEW_DECISIONS)[number];
export type GuidanceSourceImportStatus = (typeof GUIDANCE_SOURCE_IMPORT_STATUSES)[number];

export type ConfirmedGuidanceSourceStrategy = {
  sourceRef: string;
  decision: SourceReviewDecision;
  cleanupAllowed: boolean;
  note: string | null;
  fingerprint?: string | undefined;
  reviewBucket?: SourceReviewBucket | undefined;
  importStatus?: GuidanceSourceImportStatus | undefined;
};

export type ExistingGuidanceSourceLike = {
  relativePath: string;
  entryType: "file" | "directory";
  scope?: "repository-local" | "provider-project" | "provider-global";
};

export const formatSourceReviewDecision = (decision: SourceReviewDecision): string =>
  decision === "import_to_bank" ? "import to bank" : "keep external; do not import";
