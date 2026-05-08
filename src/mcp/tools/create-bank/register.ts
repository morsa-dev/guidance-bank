import { z } from "zod";

import { resolveProjectLocalBankPaths } from "../../../core/bank/projectLocalBank.js";
import { discoverProjectLocalBank } from "../../../core/projects/discoverProjectLocalBank.js";
import { finalizeCreateBankExecution, resolveCreateBankFlowContext } from "../../../core/projects/create-flow/createBankFlow.js";
import { ProjectLocalEntryStore } from "../../../storage/projectLocalEntryStore.js";
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

/*
Create/improve flow contract
============================

This tool intentionally treats create_bank as a small state machine rather than
as a generic "write some entries" mutation helper. The goal is to keep the
agent focused on one finished action per phase and to avoid duplicating
provider-local guidance into the canonical bank.

The broader product goal is centralization: useful durable guidance should end
up in one canonical AI Guidance Bank layer that works across agents and
providers, instead of staying split across provider-native files or repository
sidecars. External guidance sources are therefore candidates for migration into
the bank by default. Keeping them external is allowed, but it is an exception
driven by the user's choice rather than the default outcome of the flow.

The phases are:

1. kickoff
   - Light repository inventory only.
   - No bank writes when unresolved external guidance review is still ahead.

2. review_existing_guidance
   - The server exposes exactly one current source-review bucket:
     provider-global, provider-project, or repository-local.
   - The agent inspects those paths and resolves one bucket decision:
     import_to_bank or keep_external.
   - That decision is not a separate planning step. It directly determines what
     the current review call must do for this bucket.
   - If the decision is keep_external, the bucket is closed with no bank writes.
   - If the decision is import_to_bank, the same call must also:
     a) write the migrated canonical bank entries with create_bank.apply,
     b) clean up the migrated source content on the agent side,
     c) mark the step completed.
   - There is no separate import phase anymore. A review bucket is a complete
     action: inspect, decide, import if approved, clean up, then move on.

3. derive_from_project
   - Only after all review buckets are closed.
   - Derive additional durable rules/skills from the real repository itself.

4. finalize
   - Deduplicate, check scope split, and close obvious coverage gaps.

5. completed
   - The guided creation flow is done.

Why the flow is shaped this way:
- provider/project/local sources often already contain ready-made guidance, so
  delaying their import to a later phase only increases context load and
  duplication risk;
- each phase should correspond to one finished unit of work;
- iteration is treated as diagnostic, while phase is the real contract the
  agent should follow.

When changing this feature, keep the UX rule above intact unless you are
explicitly redesigning the flow: review buckets must not split into "decide now,
import later" again.
*/
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

      const providerSession = await options.providerSessionResolver.resolve({
        projectPath: parsedArgs.data.projectPath,
      });
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
        ...(parsedArgs.data.projectBankMode ? { projectBankMode: parsedArgs.data.projectBankMode } : {}),
      });

      const projectLocalEntryStore =
        flowContext.storageMode === "project-local"
          ? new ProjectLocalEntryStore(resolveProjectLocalBankPaths(flowContext.identity.projectPath))
          : undefined;

      if (projectLocalEntryStore !== undefined && flowContext.existingManifest !== null) {
        flowContext.extendedContext.currentBankSnapshot = await discoverProjectLocalBank(
          projectLocalEntryStore,
          true,
        );
      }

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
          `create_bank iteration mismatch for project ${flowContext.identity.projectId}: storedPhase=${flowContext.existingState?.createPhase}, requested=${requestedIteration}, effective=${flowContext.effectiveIteration}. Overwriting stored phase.`,
        );
      }

      await ensureCreateFlowProjectManifest({
        options,
        flowContext,
      });

      const localPaths =
        flowContext.projectLocalBankRoot !== null
          ? resolveProjectLocalBankPaths(flowContext.identity.projectPath)
          : null;
      const projectBankPath =
        localPaths !== null ? localPaths.root : options.repository.paths.projectDirectory(flowContext.identity.projectId);
      const rulesDirectory =
        localPaths !== null
          ? localPaths.rulesDirectory
          : options.repository.paths.projectRulesDirectory(flowContext.identity.projectId);
      const skillsDirectory =
        localPaths !== null
          ? localPaths.skillsDirectory
          : options.repository.paths.projectSkillsDirectory(flowContext.identity.projectId);

      const { currentBankSnapshot, applyResults } = await applyCreateBankRequestChanges({
        options,
        flowContext,
        args: parsedArgs.data,
        providerSession,
        ...(projectLocalEntryStore !== undefined ? { projectLocalEntryStore } : {}),
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
          providerSession,
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
        providerSession,
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
