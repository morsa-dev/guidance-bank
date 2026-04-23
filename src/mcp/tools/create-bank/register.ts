import { z } from "zod";

import { finalizeCreateBankExecution, resolveCreateBankFlowContext } from "../../../core/projects/create-flow/createBankFlow.js";
import type { McpServerRuntimeOptions, ToolRegistrar } from "../../registerTools.js";
import { MCP_TOOL_NAMES } from "../../toolNames.js";
import { writeToolAuditEvent } from "../auditUtils.js";
import {
  applyCreateBankRequestChanges,
  ensureCreateFlowProjectManifest,
} from "./execution.js";
import {
  getCreateBankRequestError,
  shouldLogIterationMismatch,
} from "./guards.js";
import {
  persistProviderGlobalGuidanceDecisions,
  shouldPersistProviderGlobalDecisions,
} from "./providerGlobalDecisions.js";
import { buildCreateBankToolPayload } from "./response.js";
import {
  CreateBankArgsSchema,
  CreateBankInputShape,
  CreateBankOutputShape,
} from "./schemas.js";

const registerCreateLikeTool = (
  server: Parameters<ToolRegistrar>[0],
  options: McpServerRuntimeOptions,
  {
    toolName,
    title,
    description,
  }: {
    toolName: typeof MCP_TOOL_NAMES.createBank | typeof MCP_TOOL_NAMES.improveBank;
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

      const requestError = getCreateBankRequestError({
        toolName,
        args: parsedArgs.data,
        flowContext,
      });
      if (requestError !== null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: requestError,
            },
          ],
        };
      }

      if (shouldLogIterationMismatch({ flowContext, requestedIteration })) {
        console.warn(
          `create_bank iteration mismatch for project ${flowContext.identity.projectId}: stored=${flowContext.existingState?.createIteration}, requested=${requestedIteration}, effective=${flowContext.effectiveIteration}. Overwriting stored iteration.`,
        );
      }

      await ensureCreateFlowProjectManifest({
        options,
        flowContext,
      });
      const projectBankPath = options.repository.paths.projectDirectory(flowContext.identity.projectId);
      const rulesDirectory = options.repository.paths.projectRulesDirectory(flowContext.identity.projectId);
      const skillsDirectory = options.repository.paths.projectSkillsDirectory(flowContext.identity.projectId);
      const { currentBankSnapshot, applyResults } = await applyCreateBankRequestChanges({
        options,
        flowContext,
        args: parsedArgs.data,
      });

      const {
        effectiveIteration: finalEffectiveIteration,
        phase: finalPhase,
        stepCompletionRequired: finalStepCompletionRequired,
        stepOutcomeRequired: finalStepOutcomeRequired,
        mustContinue: finalMustContinue,
        nextIteration: finalNextIteration,
        completedFlowThisCall: finalCompletedFlowThisCall,
        confirmedSourceStrategies: finalConfirmedSourceStrategies,
        pendingSourceReviewBuckets: finalPendingSourceReviewBuckets,
        activeImportBucket: finalActiveImportBucket,
        nextState,
      } = finalizeCreateBankExecution({
        flowContext,
        requestedIteration,
        stepCompleted: parsedArgs.data.stepCompleted ?? false,
        stepOutcome: parsedArgs.data.stepOutcome ?? null,
        stepOutcomeNote: parsedArgs.data.stepOutcomeNote ?? null,
        applyResults,
      });

      if (
        shouldPersistProviderGlobalDecisions({
          args: parsedArgs.data,
          flowContext,
        })
      ) {
        await persistProviderGlobalGuidanceDecisions({
          options,
          sessionRef: parsedArgs.data.sessionRef ?? null,
        });
      }

      await options.repository.writeProjectState(flowContext.identity.projectId, nextState);
      const payload = buildCreateBankToolPayload({
        flowContext,
        finalExecution: {
          effectiveIteration: finalEffectiveIteration,
          phase: finalPhase,
          stepCompletionRequired: finalStepCompletionRequired,
          stepOutcomeRequired: finalStepOutcomeRequired,
          mustContinue: finalMustContinue,
          nextIteration: finalNextIteration,
          completedFlowThisCall: finalCompletedFlowThisCall,
          confirmedSourceStrategies: finalConfirmedSourceStrategies,
          pendingSourceReviewBuckets: finalPendingSourceReviewBuckets,
          activeImportBucket: finalActiveImportBucket,
          nextState,
        },
        currentBankSnapshot,
        applyResults,
        paths: {
          projectBankPath,
          rulesDirectory,
          skillsDirectory,
        },
      });

      await writeToolAuditEvent({
        auditLogger: options.auditLogger,
        sessionRef: parsedArgs.data.sessionRef,
        tool: toolName,
        action: "create_flow",
        projectId: flowContext.identity.projectId,
        projectPath: flowContext.identity.projectPath,
        details: {
          phase: finalPhase,
          iteration: finalEffectiveIteration,
          creationState: nextState.creationState,
          syncRequired: flowContext.syncRequired,
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
    toolName: MCP_TOOL_NAMES.createBank,
    title: "Create Project AI Guidance Bank",
    description:
      "Create the canonical project AI Guidance Bank under the user-level AI Guidance Bank storage. AI Guidance Bank is the durable rules-and-skills layer for the project, not conversational memory.",
  });

  registerCreateLikeTool(server, options, {
    toolName: MCP_TOOL_NAMES.improveBank,
    title: "Improve Project AI Guidance Bank",
    description:
      "Review and improve an existing project AI Guidance Bank through the guided flow. Use this when the project already has a durable rules-and-skills layer that needs refinement or expansion.",
  });
};
