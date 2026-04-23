import { z } from "zod";

import { CREATE_FLOW_PHASES } from "../../../core/projects/create-flow/createFlowPhases.js";
import {
  GUIDANCE_SOURCE_IMPORT_STATUSES,
  GUIDANCE_SOURCE_STRATEGIES,
} from "../../../core/projects/create-flow/guidanceStrategies.js";
import { SOURCE_REVIEW_BUCKETS } from "../../../core/projects/create-flow/sourceReviewBuckets.js";
import { AbsoluteProjectPathSchema, SessionRefSchema } from "../sharedSchemas.js";

const GuidanceSourceStrategySchema = z.enum(GUIDANCE_SOURCE_STRATEGIES);
const GuidanceSourceImportStatusSchema = z.enum(GUIDANCE_SOURCE_IMPORT_STATUSES);
const SourceReviewDecisionInputSchema = z.enum(["import_to_bank", "keep_external"]);
const SourceReviewBucketSchema = z.enum(SOURCE_REVIEW_BUCKETS);

const ConfirmedGuidanceSourceStrategySchema = z
  .object({
    sourceRef: z.string(),
    strategy: GuidanceSourceStrategySchema,
    note: z.string().nullable(),
    fingerprint: z.string().optional(),
    reviewBucket: SourceReviewBucketSchema.optional(),
    importStatus: GuidanceSourceImportStatusSchema.optional(),
  })
  .strict();

const CreateBankApplyEntryKindSchema = z
  .enum(["rule", "rules", "skill", "skills"])
  .transform((value) => {
    if (value === "rule") {
      return "rules";
    }

    if (value === "skill") {
      return "skills";
    }

    return value;
  });

const stripPrefixedEntryPath = (kind: "rules" | "skills", rawPath: string): string => {
  const normalizedPath = rawPath.replaceAll("\\", "/").trim();
  const lowerCasePath = normalizedPath.toLowerCase();

  const matchingPrefixes =
    kind === "rules"
      ? ["rule/", "rules/"]
      : ["skill/", "skills/"];
  const conflictingPrefixes =
    kind === "rules"
      ? ["skill/", "skills/"]
      : ["rule/", "rules/"];

  for (const prefix of conflictingPrefixes) {
    if (lowerCasePath === prefix.slice(0, -1) || lowerCasePath.startsWith(prefix)) {
      throw new Error(
        `Path must be relative to the ${kind} root and must not start with \`${prefix.slice(0, -1)}/\`.`,
      );
    }
  }

  for (const prefix of matchingPrefixes) {
    if (lowerCasePath === prefix.slice(0, -1)) {
      throw new Error(`Path must be relative to the ${kind} root and cannot be just \`${prefix.slice(0, -1)}\`.`);
    }

    if (lowerCasePath.startsWith(prefix)) {
      return normalizedPath.slice(prefix.length);
    }
  }

  return normalizedPath;
};

export const CreateBankApplyWriteSchema = z
  .object({
    kind: CreateBankApplyEntryKindSchema,
    scope: z.enum(["shared", "project"]),
    path: z.string().trim().min(1),
    content: z.string().min(1),
    baseSha256: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      stripPrefixedEntryPath(value.kind, value.path);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["path"],
        message: error instanceof Error ? error.message : "Invalid create_bank.apply write path.",
      });
    }
  })
  .transform((value) => ({
    ...value,
    path: stripPrefixedEntryPath(value.kind, value.path),
  }));

export const CreateBankApplyDeletionSchema = z
  .object({
    kind: CreateBankApplyEntryKindSchema,
    scope: z.enum(["shared", "project"]),
    path: z.string().trim().min(1),
    baseSha256: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      stripPrefixedEntryPath(value.kind, value.path);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["path"],
        message: error instanceof Error ? error.message : "Invalid create_bank.apply deletion path.",
      });
    }
  })
  .transform((value) => ({
    ...value,
    path: stripPrefixedEntryPath(value.kind, value.path),
  }));

export const CreateBankInputShape = {
  projectPath: AbsoluteProjectPathSchema,
  iteration: z.number().int().nonnegative().optional().describe("Current create-flow iteration. Defaults to 0."),
  sessionRef: SessionRefSchema,
  stepCompleted: z
    .boolean()
    .optional()
    .describe("Marks the current create-flow step as complete when advancing to the next iteration."),
  stepOutcome: z
    .enum(["applied", "no_changes"])
    .optional()
    .describe(
      "Explicit result of the current create-flow step when advancing. Use `applied` if this phase already produced canonical changes, or `no_changes` if the phase intentionally produced no bank mutations.",
    ),
  stepOutcomeNote: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Short explanation required when `stepOutcome` is `no_changes`."),
  referenceProjectIds: z
    .array(z.string().trim().min(1))
    .max(5)
    .optional()
    .describe("Optional project ids of existing AI Guidance Banks to use as reference material for the new project bank."),
  sourceReviewDecision: SourceReviewDecisionInputSchema.optional().describe(
    "Decision for the current external-guidance review bucket. Use `import_to_bank` to let the agent centralize useful guidance from this bucket into AI Guidance Bank, or `keep_external` to leave those sources provider-native/local and avoid importing them.",
  ),
  sourceReviewBucket: SourceReviewBucketSchema.optional().describe(
    "Which external-guidance review bucket this decision applies to: `repository-local`, `provider-project`, or `provider-global`.",
  ),
  apply: z
    .object({
      writes: z
        .array(CreateBankApplyWriteSchema)
        .default([])
        .describe("Full-document writes to apply in this create-flow step."),
      deletions: z
        .array(CreateBankApplyDeletionSchema)
        .default([])
        .describe("Entry deletions to apply in this create-flow step."),
    })
    .strict()
    .optional()
    .describe("Optional batched entry mutations for the current create-flow step."),
} as const;

export const CreateBankArgsSchema = z
  .object(CreateBankInputShape)
  .strict()
  .superRefine((value, ctx) => {
    if (value.stepOutcome === "no_changes" && value.stepOutcomeNote === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["stepOutcomeNote"],
        message: "stepOutcomeNote is required when stepOutcome is `no_changes`.",
      });
    }

    if (value.stepOutcome === undefined && value.stepOutcomeNote !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["stepOutcome"],
        message: "stepOutcome is required when stepOutcomeNote is provided.",
      });
    }
  });

export const CreateBankOutputShape = {
  status: z.enum(["created", "already_exists"]),
  syncRequired: z.boolean(),
  projectId: z.string(),
  projectName: z.string(),
  projectPath: z.string(),
  projectBankPath: z.string(),
  rulesDirectory: z.string(),
  skillsDirectory: z.string(),
  detectedStacks: z.array(z.string()),
  phase: z.enum(CREATE_FLOW_PHASES),
  iteration: z.number().int().nonnegative(),
  discoveredSources: z.array(
    z.object({
      kind: z.enum([
        "agents",
        "claude-md",
        "copilot",
        "cursor",
        "claude",
        "codex",
        "codex-project",
        "claude-global",
        "codex-global",
      ]),
      entryType: z.enum(["file", "directory"]),
      scope: z.enum(["repository-local", "provider-project", "provider-global"]),
      provider: z.enum(["codex", "cursor", "claude"]).nullable(),
      path: z.string(),
      relativePath: z.string(),
      fingerprint: z.string(),
    }),
  ),
  pendingSourceReviewBuckets: z.array(
    z.object({
      bucket: SourceReviewBucketSchema,
      title: z.string(),
      promptLabel: z.string(),
      sources: z.array(
        z.object({
          sourceRef: z.string(),
          entryType: z.enum(["file", "directory"]),
          provider: z.enum(["codex", "cursor", "claude"]).nullable(),
          kind: z.enum([
            "agents",
            "claude-md",
            "copilot",
            "cursor",
            "claude",
            "codex",
            "codex-project",
            "claude-global",
            "codex-global",
          ]),
          path: z.string(),
        }),
      ),
      providers: z.array(z.enum(["codex", "cursor", "claude"])),
      sourceCount: z.number().int().nonnegative(),
      fileCount: z.number().int().nonnegative(),
      directoryCount: z.number().int().nonnegative(),
    }),
  ),
  nextSourceReviewBucket: SourceReviewBucketSchema.nullable(),
  currentBankSnapshot: z.object({
    exists: z.boolean(),
    entries: z.array(
      z.object({
        kind: z.enum(["rules", "skills"]),
        scope: z.literal("project"),
        path: z.string(),
        id: z.string(),
        sha256: z.string(),
      }),
    ),
  }),
  selectedReferenceProjects: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      projectPath: z.string(),
      projectBankPath: z.string(),
      detectedStacks: z.array(z.string()),
      sharedStacks: z.array(z.string()),
    }),
  ),
  creationState: z.enum(["unknown", "postponed", "declined", "creating", "ready"]),
  confirmedSourceStrategies: z.array(ConfirmedGuidanceSourceStrategySchema),
  stepCompletionRequired: z.boolean(),
  sourceStrategyRequired: z.boolean(),
  stepOutcomeRequired: z.boolean(),
  mustContinue: z.boolean(),
  nextIteration: z.number().int().nonnegative().nullable(),
  existingBankUpdatedAt: z.string().nullable(),
  existingBankUpdatedDaysAgo: z.number().int().nonnegative().nullable(),
  applyResults: z.object({
    writes: z.array(
      z.object({
        kind: z.enum(["rules", "skills"]),
        scope: z.enum(["shared", "project"]),
        path: z.string(),
        status: z.enum(["created", "updated", "conflict"]),
        expectedSha256: z.string().nullable(),
        actualSha256: z.string().nullable(),
      }),
    ),
    deletions: z.array(
      z.object({
        kind: z.enum(["rules", "skills"]),
        scope: z.enum(["shared", "project"]),
        path: z.string(),
        status: z.enum(["deleted", "not_found", "conflict"]),
        expectedSha256: z.string().nullable(),
        actualSha256: z.string().nullable(),
      }),
    ),
  }),
  prompt: z.string(),
  creationPrompt: z.string().nullable(),
  text: z.string(),
} as const;

export type CreateBankArgs = z.infer<typeof CreateBankArgsSchema>;
