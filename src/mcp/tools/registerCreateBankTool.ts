import { z } from "zod";

import {
  createProjectBankManifest,
} from "../../core/bank/project.js";
import { buildCreateBankPrompt } from "../../core/projects/createBankPrompt.js";
import { finalizeCreateBankExecution, resolveCreateBankFlowContext } from "../../core/projects/createBankFlow.js";
import { discoverCurrentProjectBank } from "../../core/projects/discoverCurrentProjectBank.js";
import {
  buildCreateBankIterationPrompt,
  buildReadyProjectBankPrompt,
} from "../../core/projects/createBankIterationPrompt.js";
import { getCreateFlowPhase } from "../../core/projects/createFlowPhases.js";
import type { McpServerRuntimeOptions, ToolRegistrar } from "../registerTools.js";
import { applyCreateBankChanges } from "./createBankApply.js";
import {
  buildCreateBankResponseText,
  getCreateBankApplyBlockedMessage,
  normalizeApplyDeletions,
  normalizeApplyWrites,
  shouldWarnAboutIterationMismatch,
} from "./createBankToolRuntime.js";
import { writeToolAuditEvent } from "./auditUtils.js";
import {
  CreateBankArgsSchema,
  CreateBankInputShape,
  CreateBankOutputShape,
} from "./createBankToolSchemas.js";

const registerCreateLikeTool = (
  server: Parameters<ToolRegistrar>[0],
  options: McpServerRuntimeOptions,
  {
    toolName,
    title,
    description,
  }: {
    toolName: "create_bank" | "improve_bank";
    title: string;
    description: string;
  },
) => {
  server.registerTool(
    toolName,
    {
      title,
      description,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: CreateBankInputShape,
      outputSchema: CreateBankOutputShape,
    },
    async (args) => {
      const parsedArgs = CreateBankArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool ${toolName}: ${z.prettifyError(parsedArgs.error)}`,
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
        hasApply: parsedArgs.data.apply !== undefined,
        stepOutcome: parsedArgs.data.stepOutcome ?? null,
        stepOutcomeNote: parsedArgs.data.stepOutcomeNote ?? null,
        ...(parsedArgs.data.sourceReviewDecision ? { sourceReviewDecision: parsedArgs.data.sourceReviewDecision } : {}),
        ...(parsedArgs.data.referenceProjectIds ? { referenceProjectIds: parsedArgs.data.referenceProjectIds } : {}),
      });

      if (flowContext.unknownReferenceIds.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown reference project ids for tool ${toolName}: ${flowContext.unknownReferenceIds.join(", ")}`,
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
        sourceStrategyRequired,
        stepOutcomeRequired,
        syncRequired,
        improvementEntryPoint,
        extendedContext,
        confirmedSourceStrategies,
      } = flowContext;

      if (
        existingState !== null &&
        shouldWarnAboutIterationMismatch(
          existingState.createIteration,
          requestedIteration,
          effectiveIteration,
          stepCompletionRequired,
          sourceStrategyRequired,
          stepOutcomeRequired,
        )
      ) {
        console.warn(
          `create_bank iteration mismatch for project ${identity.projectId}: stored=${existingState.createIteration}, requested=${requestedIteration}, effective=${effectiveIteration}. Overwriting stored iteration.`,
        );
      }
      const applyBlockedMessage = getCreateBankApplyBlockedMessage({
        hasApply: parsedArgs.data.apply !== undefined,
        syncRequired,
        improvementEntryPoint,
        phase: syncRequired
          ? "sync_required"
          : improvementEntryPoint
            ? "ready_to_improve"
            : getCreateFlowPhase(effectiveIteration),
        hasDiscoveredSources: extendedContext.discoveredSources.length > 0,
        stepCompletionRequired,
        sourceStrategyRequired,
        stepOutcomeRequired,
      });
      if (applyBlockedMessage !== null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: applyBlockedMessage,
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
      const {
        effectiveIteration: finalEffectiveIteration,
        phase: finalPhase,
        stepCompletionRequired: finalStepCompletionRequired,
        stepOutcomeRequired: finalStepOutcomeRequired,
        mustContinue: finalMustContinue,
        nextIteration: finalNextIteration,
        completedFlowThisCall: finalCompletedFlowThisCall,
        nextState,
      } = finalizeCreateBankExecution({
        flowContext,
        requestedIteration,
        stepCompleted: parsedArgs.data.stepCompleted ?? false,
        stepOutcome: parsedArgs.data.stepOutcome ?? null,
        stepOutcomeNote: parsedArgs.data.stepOutcomeNote ?? null,
        applyResults,
      });
      await options.repository.writeProjectState(identity.projectId, nextState);
      const prompt =
        syncRequired
          ? "Project Memory Bank already exists for this repository and requires synchronization before reuse. Sync only reconciles the existing bank with the current Memory Bank storage version; it does not create or improve project content. Ask the user whether to synchronize it now or postpone it. After that, call `resolve_context` again."
          : improvementEntryPoint
            ? buildReadyProjectBankPrompt({
                updatedAt: existingBankUpdatedAt,
                updatedDaysAgo: existingBankUpdatedDaysAgo,
              })
          : finalMustContinue || finalCompletedFlowThisCall
            ? buildCreateBankIterationPrompt({
                iteration: finalEffectiveIteration,
                projectName: identity.projectName,
                projectPath: identity.projectPath,
                projectBankPath,
                rulesDirectory,
                skillsDirectory,
                detectedStacks: projectContext.detectedStacks,
                selectedReferenceProjects,
                discoveredSources: extendedContext.discoveredSources,
                confirmedSourceStrategies,
                currentBankSnapshot,
                hasExistingProjectBank: existingManifest !== null,
              })
            : "Project Memory Bank already exists for this repository and is ready.";
      const creationPrompt =
        finalEffectiveIteration === 0
          ? buildCreateBankPrompt({
              projectName: identity.projectName,
              projectPath: identity.projectPath,
              projectBankPath,
              rulesDirectory,
              skillsDirectory,
              detectedStacks: projectContext.detectedStacks,
              selectedReferenceProjects,
            })
          : null;

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
        phase: finalPhase,
        iteration: finalEffectiveIteration,
        discoveredSources: extendedContext.discoveredSources,
        currentBankSnapshot,
        selectedReferenceProjects,
        creationState: nextState.creationState,
        confirmedSourceStrategies,
        stepCompletionRequired: finalStepCompletionRequired,
        sourceStrategyRequired,
        stepOutcomeRequired: finalStepOutcomeRequired,
        mustContinue: finalMustContinue,
        nextIteration: finalNextIteration,
        existingBankUpdatedAt,
        existingBankUpdatedDaysAgo,
        applyResults,
        prompt,
        creationPrompt,
        text: buildCreateBankResponseText({
          syncRequired,
          applyResults,
          stepCompletionRequired: finalStepCompletionRequired,
          sourceStrategyRequired,
          stepOutcomeRequired: finalStepOutcomeRequired,
          nextIteration: finalNextIteration,
          improvementEntryPoint,
          mustContinue: finalMustContinue,
          completedFlowThisCall: finalCompletedFlowThisCall,
          phase: finalPhase,
        }),
      } as const;

      await writeToolAuditEvent({
        auditLogger: options.auditLogger,
        sessionRef: parsedArgs.data.sessionRef,
        tool: toolName,
        action: "create_flow",
        projectId: identity.projectId,
        projectPath: identity.projectPath,
        details: {
          phase: finalPhase,
          iteration: finalEffectiveIteration,
          creationState: nextState.creationState,
          syncRequired,
          mustContinue: finalMustContinue,
          applyWrites: applyResults.writes.length,
          applyDeletions: applyResults.deletions.length,
        },
      });

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

export const registerCreateBankTool: ToolRegistrar = (server, options) => {
  registerCreateLikeTool(server, options, {
    toolName: "create_bank",
    title: "Create Project Memory Bank",
    description:
      "Create or improve the canonical project Memory Bank under the user-level Memory Bank storage. Prefer this tool when no project bank exists yet or when the user explicitly asks to initialize one.",
  });

  registerCreateLikeTool(server, options, {
    toolName: "improve_bank",
    title: "Improve Project Memory Bank",
    description:
      "Review and improve an existing project Memory Bank through the guided flow. Prefer this tool when a project bank already exists and the user wants to refine or expand it.",
  });
};
