import { z } from "zod";
import type { ProviderSessionSource } from "../../mcp/providerSessionResolver.js";

export type ProviderGlobalGuidanceDecision = {
  keepExternal: boolean;
  decidedAt: string | null;
  providerSessionId: string | null;
  providerSessionSource: ProviderSessionSource;
  note: string | null;
};

export type ExternalGuidanceDecisionState = {
  schemaVersion: 1;
  updatedAt: string;
  providerGlobal: ProviderGlobalGuidanceDecision;
};

const defaultProviderGlobalGuidanceDecision = (): ProviderGlobalGuidanceDecision => ({
  keepExternal: false,
  decidedAt: null,
  providerSessionId: null,
  providerSessionSource: "unresolved",
  note: null,
});

const ProviderGlobalGuidanceDecisionSchema = z
  .object({
    keepExternal: z.boolean().default(false),
    decidedAt: z.iso.datetime().nullable().default(null),
    providerSessionId: z.string().min(1).nullable().default(null),
    providerSessionSource: z
      .enum(["codex_parent_process", "cursor_state", "claude_code_hook", "unresolved"])
      .default("unresolved"),
    note: z.string().min(1).nullable().default(null),
  })
  .strict();

const CurrentExternalGuidanceDecisionStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
    providerGlobal: ProviderGlobalGuidanceDecisionSchema.default(defaultProviderGlobalGuidanceDecision()),
  })
  .strict();

const LegacyExternalGuidanceSourceDecisionSchema = z
  .object({
    decision: z.string(),
  })
  .passthrough();

const LegacyExternalGuidanceDecisionStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
    sources: z.record(z.string().min(1), LegacyExternalGuidanceSourceDecisionSchema).default({}),
  })
  .passthrough()
  .transform((value): ExternalGuidanceDecisionState => {
    const keepExternal = Object.values(value.sources).some(
      (source) => source.decision === "keep_provider_native" || source.decision === "ignore",
    );

    return {
      schemaVersion: 1,
      updatedAt: value.updatedAt,
      providerGlobal: {
        keepExternal,
        decidedAt: keepExternal ? value.updatedAt : null,
        providerSessionId: null,
        providerSessionSource: "unresolved",
        note: keepExternal
          ? "Migrated from legacy provider-global source-level decision state."
          : null,
      },
    };
  });

export const createExternalGuidanceDecisionState = (now = new Date()): ExternalGuidanceDecisionState => ({
  schemaVersion: 1,
  updatedAt: now.toISOString(),
  providerGlobal: defaultProviderGlobalGuidanceDecision(),
});

export const parseExternalGuidanceDecisionState = (value: unknown): ExternalGuidanceDecisionState =>
  z.union([CurrentExternalGuidanceDecisionStateSchema, LegacyExternalGuidanceDecisionStateSchema]).parse(value);
