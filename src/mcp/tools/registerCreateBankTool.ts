import { z } from "zod";

import {
  createProjectBankManifest,
  createProjectBankState,
  markProjectBankSynced,
  setProjectBankCreateIteration,
} from "../../core/bank/project.js";
import { buildCreateBankPrompt } from "../../core/projects/createBankPrompt.js";
import { resolveCreateBankFlowContext } from "../../core/projects/createBankFlow.js";
import { discoverCurrentProjectBank } from "../../core/projects/discoverCurrentProjectBank.js";
import {
  buildCreateBankIterationPrompt,
  buildReadyProjectBankPrompt,
} from "../../core/projects/createBankIterationPrompt.js";
import { CREATE_FLOW_PHASES, getCreateFlowPhase } from "../../core/projects/createFlowPhases.js";
import type { ToolRegistrar } from "../registerTools.js";
import { applyCreateBankChanges } from "./createBankApply.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";

const CreateBankApplyWriteSchema = z
  .object({
    kind: z.enum(["rules", "skills"]),
    scope: z.enum(["shared", "project"]),
    path: z.string().trim().min(1),
    content: z.string().min(1),
    baseSha256: z.string().trim().min(1).optional(),
  })
  .strict();

const CreateBankApplyDeletionSchema = z
  .object({
    kind: z.enum(["rules", "skills"]),
    scope: z.enum(["shared", "project"]),
    path: z.string().trim().min(1),
    baseSha256: z.string().trim().min(1).optional(),
  })
  .strict();

const CreateBankArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
    iteration: z.number().int().nonnegative().optional(),
    sessionRef: z.string().trim().min(1).optional(),
    stepCompleted: z
      .boolean()
      .optional()
      .describe("Marks the current create-flow step as complete when advancing to the next iteration."),
    referenceProjectIds: z
      .array(z.string().trim().min(1))
      .max(5)
      .optional()
      .describe("Optional project ids of existing Memory Banks to use as reference material for the new project bank."),
    apply: z
      .object({
        writes: z.array(CreateBankApplyWriteSchema).default([]),
        deletions: z.array(CreateBankApplyDeletionSchema).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();

const shouldWarnAboutIterationMismatch = (
  storedIteration: number | null,
  requestedIteration: number,
  effectiveIteration: number,
  stepCompletionRequired: boolean,
): boolean => {
  if (storedIteration === null) {
    return false;
  }

  if (stepCompletionRequired) {
    return false;
  }

  if (requestedIteration === effectiveIteration) {
    return false;
  }

  if (requestedIteration === 0) {
    return false;
  }

  return true;
};

const normalizeApplyWrites = (
  writes: readonly z.infer<typeof CreateBankApplyWriteSchema>[],
) => writes.map((write) => ({
  kind: write.kind,
  scope: write.scope,
  path: write.path,
  content: write.content,
  ...(write.baseSha256 !== undefined ? { baseSha256: write.baseSha256 } : {}),
}));

const normalizeApplyDeletions = (
  deletions: readonly z.infer<typeof CreateBankApplyDeletionSchema>[],
) => deletions.map((deletion) => ({
  kind: deletion.kind,
  scope: deletion.scope,
  path: deletion.path,
  ...(deletion.baseSha256 !== undefined ? { baseSha256: deletion.baseSha256 } : {}),
}));

export const registerCreateBankTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "create_bank",
    {
      title: "Create Project Memory Bank",
      description:
        "Create or reuse the canonical project Memory Bank scaffold under the user-level Memory Bank storage and return instructions for the agent to populate it from the real codebase.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        projectPath: AbsoluteProjectPathSchema,
        iteration: z.number().int().nonnegative().optional().describe("Current create-flow iteration. Defaults to 0."),
        sessionRef: z.string().trim().min(1).optional().describe("Optional agent session reference for audit logging."),
        stepCompleted: z
          .boolean()
          .optional()
          .describe("Marks the current create-flow step as complete when advancing to the next iteration."),
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
      },
      outputSchema: {
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
            kind: z.enum(["agents", "claude-md", "copilot", "cursor", "claude", "codex"]),
            entryType: z.enum(["file", "directory"]),
            path: z.string(),
            relativePath: z.string(),
          }),
        ),
        projectEvidence: z.object({
          topLevelDirectories: z.array(z.string()),
          evidenceFiles: z.array(
            z.object({
              kind: z.enum(["config", "doc"]),
              relativePath: z.string(),
            }),
          ),
        }),
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
        creationPrompt: z.string(),
        text: z.string(),
      },
    },
    async (args) => {
      const parsedArgs = CreateBankArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool create_bank: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      const requestedIteration = parsedArgs.data.iteration ?? 0;
      const flowContext = await resolveCreateBankFlowContext({
        repository: options.repository,
        projectPath: parsedArgs.data.projectPath,
        requestedIteration,
        stepCompleted: parsedArgs.data.stepCompleted ?? false,
        ...(parsedArgs.data.referenceProjectIds ? { referenceProjectIds: parsedArgs.data.referenceProjectIds } : {}),
      });

      if (flowContext.unknownReferenceIds.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown reference project ids for tool create_bank: ${flowContext.unknownReferenceIds.join(", ")}`,
            },
          ],
        };
      }

      const {
        identity,
        projectContext,
        existingManifest,
        existingState,
        selectedReferenceProjects,
        existingBankUpdatedAt,
        existingBankUpdatedDaysAgo,
        effectiveIteration,
        stepCompletionRequired,
        shouldTrackCreateFlow,
        nextCreationState,
        syncRequired,
        improvementEntryPoint,
        mustContinue,
        nextIteration,
        completedFlowThisCall,
        extendedContext,
        manifestStorageVersion,
      } = flowContext;

      if (
        existingState !== null &&
        shouldWarnAboutIterationMismatch(
          existingState.createIteration,
          requestedIteration,
          effectiveIteration,
          stepCompletionRequired,
        )
      ) {
        console.warn(
          `create_bank iteration mismatch for project ${identity.projectId}: stored=${existingState.createIteration}, requested=${requestedIteration}, effective=${effectiveIteration}. Overwriting stored iteration.`,
        );
      }

      if (parsedArgs.data.apply && syncRequired) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Cannot apply create-flow changes while sync_bank is required. Reconcile the existing project bank first.",
            },
          ],
        };
      }

      if (parsedArgs.data.apply && improvementEntryPoint) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Cannot apply create-flow changes from the ready-to-improve entry point. Ask the user whether to improve the existing bank first, then continue with iteration: 1.",
            },
          ],
        };
      }

      if (parsedArgs.data.apply && stepCompletionRequired) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Cannot apply create-flow changes while step completion is unresolved. Re-call create_bank for the current step before applying changes or advancing.",
            },
          ],
        };
      }

      if (existingManifest === null) {
        await options.repository.ensureProjectStructure(identity.projectId);
        await options.repository.writeProjectManifest(
          identity.projectId,
          createProjectBankManifest(
            identity.projectId,
            identity.projectName,
            identity.projectPath,
            projectContext.detectedStacks,
          ),
        );
      }

      let nextState = existingState;
      if (existingManifest === null) {
        nextState = markProjectBankSynced(createProjectBankState(nextCreationState), manifestStorageVersion);
      } else if (nextState === null) {
        nextState = createProjectBankState(nextCreationState);
      } else if (shouldTrackCreateFlow) {
        nextState = {
          ...nextState,
          creationState: nextCreationState,
        };
      }

      if (shouldTrackCreateFlow) {
        nextState = setProjectBankCreateIteration(nextState, effectiveIteration);
      }
      await options.repository.writeProjectState(identity.projectId, nextState);

      const projectBankPath = options.repository.paths.projectDirectory(identity.projectId);
      const rulesDirectory = options.repository.paths.projectRulesDirectory(identity.projectId);
      const skillsDirectory = options.repository.paths.projectSkillsDirectory(identity.projectId);
      let currentBankSnapshot =
        existingManifest === null
          ? {
              ...extendedContext.currentBankSnapshot,
              exists: true,
            }
          : extendedContext.currentBankSnapshot;
      const applyResults = parsedArgs.data.apply
        ? await applyCreateBankChanges({
            repository: options.repository,
            auditLogger: options.auditLogger,
            projectId: identity.projectId,
            projectPath: identity.projectPath,
            sessionRef: parsedArgs.data.sessionRef ?? null,
            writes: normalizeApplyWrites(parsedArgs.data.apply.writes),
            deletions: normalizeApplyDeletions(parsedArgs.data.apply.deletions),
          })
        : {
            writes: [],
            deletions: [],
          };
      if (parsedArgs.data.apply) {
        currentBankSnapshot = await discoverCurrentProjectBank(options.repository, identity.projectId, true);
      }
      const creationPrompt = buildCreateBankPrompt({
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        projectBankPath,
        rulesDirectory,
        skillsDirectory,
        detectedStacks: projectContext.detectedStacks,
        selectedReferenceProjects,
      });
      const prompt =
        syncRequired
          ? "Project Memory Bank already exists for this repository and requires synchronization before reuse. Sync only reconciles the existing bank with the current Memory Bank storage version; it does not create or improve project content. Ask the user whether to synchronize it now or postpone it. After that, call `resolve_context` again."
          : improvementEntryPoint
            ? buildReadyProjectBankPrompt({
                updatedAt: existingBankUpdatedAt,
                updatedDaysAgo: existingBankUpdatedDaysAgo,
              })
          : mustContinue || completedFlowThisCall
            ? buildCreateBankIterationPrompt({
                iteration: effectiveIteration,
                projectName: identity.projectName,
                projectPath: identity.projectPath,
                projectBankPath,
                rulesDirectory,
                skillsDirectory,
                detectedStacks: projectContext.detectedStacks,
                selectedReferenceProjects,
                discoveredSources: extendedContext.discoveredSources,
                projectEvidence: extendedContext.projectEvidence,
                currentBankSnapshot,
                hasExistingProjectBank: existingManifest !== null,
              })
            : "Project Memory Bank already exists for this repository and is ready.";
      const phase = syncRequired
        ? "sync_required"
        : improvementEntryPoint
          ? "ready_to_improve"
          : getCreateFlowPhase(effectiveIteration);

      const payload = {
        status: existingManifest === null ? "created" : "already_exists",
        syncRequired,
        projectId: identity.projectId,
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        projectBankPath,
        rulesDirectory,
        skillsDirectory,
        detectedStacks: projectContext.detectedStacks,
        phase,
        iteration: effectiveIteration,
        discoveredSources: extendedContext.discoveredSources,
        projectEvidence: extendedContext.projectEvidence,
        currentBankSnapshot,
        selectedReferenceProjects,
        creationState: nextState.creationState,
        stepCompletionRequired,
        mustContinue,
        nextIteration,
        existingBankUpdatedAt,
        existingBankUpdatedDaysAgo,
        applyResults,
        prompt,
        creationPrompt,
        text:
          syncRequired
            ? "Call sync_bank to reconcile the existing project bank before any create or improve flow."
            : applyResults.writes.length > 0 || applyResults.deletions.length > 0
              ? stepCompletionRequired && nextIteration !== null
                ? `Create-flow changes were applied. Mark the current step complete before advancing. Re-call create_bank with iteration: ${nextIteration} and stepCompleted: true once the current step is actually done.`
                : mustContinue && nextIteration !== null
                  ? `Create-flow changes were applied. Re-call create_bank with iteration: ${nextIteration} and stepCompleted: true once the current step is complete.`
                  : completedFlowThisCall
                    ? "Create-flow changes were applied and the flow is complete. Tell the user the project bank is ready."
                    : "Create-flow changes were applied for the current step."
            : stepCompletionRequired && nextIteration !== null
              ? `Mark the current create step complete before advancing. Re-call create_bank with iteration: ${nextIteration} and stepCompleted: true once the current step is actually done.`
            : improvementEntryPoint
              ? "Project Memory Bank already exists. Ask the user whether to improve it. If they agree, call create_bank with iteration: 1."
            : mustContinue && nextIteration !== null
              ? `Call create_bank with iteration: ${nextIteration} and stepCompleted: true after the current step is complete.`
              : completedFlowThisCall
                ? "Create flow complete. Tell the user the project bank is ready."
                : "Project Memory Bank is ready.",
      } as const;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
        structuredContent: payload,
      };
    },
  );
};
