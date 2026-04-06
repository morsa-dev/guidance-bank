import { z } from "zod";

import { CREATE_FLOW_PHASES } from "../../core/projects/createFlowPhases.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";

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

export const CreateBankApplyWriteSchema = z
  .object({
    kind: CreateBankApplyEntryKindSchema,
    scope: z.enum(["shared", "project"]),
    path: z.string().trim().min(1),
    content: z.string().min(1),
    baseSha256: z.string().trim().min(1).optional(),
  })
  .strict();

export const CreateBankApplyDeletionSchema = z
  .object({
    kind: CreateBankApplyEntryKindSchema,
    scope: z.enum(["shared", "project"]),
    path: z.string().trim().min(1),
    baseSha256: z.string().trim().min(1).optional(),
  })
  .strict();

export const CreateBankInputShape = {
  projectPath: AbsoluteProjectPathSchema,
  iteration: z.number().int().nonnegative().optional().describe("Current create-flow iteration. Defaults to 0."),
  sessionRef: z.string().trim().min(1).optional().describe("Optional agent session reference for audit logging."),
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
    .describe("Optional project ids of existing Memory Banks to use as reference material for the new project bank."),
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
        "cursor-project",
        "claude-project",
        "codex-project",
      ]),
      entryType: z.enum(["file", "directory"]),
      scope: z.enum(["repository-local", "provider-project"]),
      provider: z.enum(["codex", "cursor", "claude"]).nullable(),
      path: z.string(),
      relativePath: z.string(),
    }),
  ),
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
  creationState: z.enum(["unknown", "declined", "creating", "ready"]),
  stepCompletionRequired: z.boolean(),
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
