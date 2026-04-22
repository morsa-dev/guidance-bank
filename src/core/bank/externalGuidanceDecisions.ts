import { z } from "zod";

export const EXTERNAL_GUIDANCE_DECISIONS = [
  "copy_to_shared_keep_source",
  "move_to_bank_cleanup_allowed",
  "keep_provider_native",
  "ignore",
] as const;

export type ExternalGuidanceDecision = (typeof EXTERNAL_GUIDANCE_DECISIONS)[number];

export type ExternalGuidanceSourceDecision = {
  sourceKey: string;
  sourceRef: string;
  scope: "provider-global";
  provider: "codex" | "cursor" | "claude";
  kind: string;
  entryType: "file" | "directory";
  fingerprint: string;
  decision: ExternalGuidanceDecision;
  strategy: string;
  decidedAt: string;
  sessionRef: string | null;
  note: string | null;
};

export type ExternalGuidanceDecisionState = {
  schemaVersion: 1;
  updatedAt: string;
  sources: Record<string, ExternalGuidanceSourceDecision>;
};

const ExternalGuidanceDecisionSchema = z.enum(EXTERNAL_GUIDANCE_DECISIONS);

const ExternalGuidanceSourceDecisionSchema = z
  .object({
    sourceKey: z.string().min(1),
    sourceRef: z.string().min(1),
    scope: z.literal("provider-global"),
    provider: z.enum(["codex", "cursor", "claude"]),
    kind: z.string().min(1),
    entryType: z.enum(["file", "directory"]),
    fingerprint: z.string().min(1),
    decision: ExternalGuidanceDecisionSchema,
    strategy: z.string().min(1),
    decidedAt: z.iso.datetime(),
    sessionRef: z.string().min(1).nullable(),
    note: z.string().min(1).nullable(),
  })
  .strict();

export const ExternalGuidanceDecisionStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
    sources: z.record(z.string().min(1), ExternalGuidanceSourceDecisionSchema).default({}),
  })
  .strict();

export const createExternalGuidanceSourceKey = ({
  scope,
  provider,
  relativePath,
}: {
  scope: "provider-global";
  provider: "codex" | "cursor" | "claude";
  relativePath: string;
}): string => `${scope}:${provider}:${relativePath}`;

export const createExternalGuidanceDecisionState = (now = new Date()): ExternalGuidanceDecisionState => ({
  schemaVersion: 1,
  updatedAt: now.toISOString(),
  sources: {},
});

export const parseExternalGuidanceDecisionState = (value: unknown): ExternalGuidanceDecisionState =>
  ExternalGuidanceDecisionStateSchema.parse(value);
