import { z } from "zod";

import {
  createProjectBankManifest,
  createProjectBankState,
  markProjectBankSynced,
  setProjectBankCreateIteration,
} from "../../core/bank/project.js";
import { buildCreateBankPrompt } from "../../core/projects/createBankPrompt.js";
import { resolveCreateBankFlowContext } from "../../core/projects/createBankFlow.js";
import {
  buildCreateBankIterationPrompt,
  buildReadyProjectBankPrompt,
} from "../../core/projects/createBankIterationPrompt.js";
import { CREATE_FLOW_PHASES, getCreateFlowPhase } from "../../core/projects/createFlowPhases.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";

const CreateBankArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
    iteration: z.number().int().nonnegative().optional(),
    stepCompleted: z
      .boolean()
      .optional()
      .describe("Marks the current create-flow step as complete when advancing to the next iteration."),
    referenceProjectIds: z
      .array(z.string().trim().min(1))
      .max(5)
      .optional()
      .describe("Optional project ids of existing Memory Banks to use as reference material for the new project bank."),
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
        stepCompleted: z
          .boolean()
          .optional()
          .describe("Marks the current create-flow step as complete when advancing to the next iteration."),
        referenceProjectIds: z
          .array(z.string().trim().min(1))
          .max(5)
          .optional()
          .describe("Optional project ids of existing Memory Banks to use as reference material for the new project bank."),
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
      const currentBankSnapshot =
        existingManifest === null
          ? {
              ...extendedContext.currentBankSnapshot,
              exists: true,
            }
          : extendedContext.currentBankSnapshot;
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
        prompt,
        creationPrompt,
        text:
          syncRequired
            ? "Call sync_bank to reconcile the existing project bank before any create or improve flow."
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
