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
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { applyCreateBankChanges } from "./createBankApply.js";
import {
  createExternalGuidanceSourceKey,
  type ExternalGuidanceDecision,
} from "../../core/bank/externalGuidanceDecisions.js";
import type { ExistingGuidanceSource } from "../../core/projects/discoverExistingGuidance.js";
import type { ConfirmedGuidanceSourceStrategy, GuidanceSourceStrategy } from "../../core/projects/guidanceStrategies.js";
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

const toExternalGuidanceDecision = (strategy: GuidanceSourceStrategy): ExternalGuidanceDecision => {
  switch (strategy) {
    case "copy":
    case "keep_source_fill_gaps":
      return "copy_to_shared_keep_source";
    case "move":
      return "move_to_bank_cleanup_allowed";
    case "keep_provider_native":
      return "keep_provider_native";
    case "ignore":
      return "ignore";
  }
};

const recordProviderGlobalGuidanceDecisions = async ({
  options,
  discoveredSources,
  confirmedSourceStrategies,
  sessionRef,
}: {
  options: McpServerRuntimeOptions;
  discoveredSources: readonly ExistingGuidanceSource[];
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[];
  sessionRef: string | null;
}): Promise<void> => {
  const strategiesBySourceRef = new Map(confirmedSourceStrategies.map((strategy) => [strategy.sourceRef, strategy]));
  const providerGlobalSources = discoveredSources.filter(
    (source) => source.scope === "provider-global" && source.provider !== null,
  );

  if (providerGlobalSources.length === 0) {
    return;
  }

  const state = await options.repository.readExternalGuidanceDecisionState();
  const decidedAt = new Date().toISOString();

  for (const source of providerGlobalSources) {
    if (source.provider === null) {
      continue;
    }

    const strategy = strategiesBySourceRef.get(source.relativePath);
    if (!strategy) {
      continue;
    }

    const sourceKey = createExternalGuidanceSourceKey({
      scope: "provider-global",
      provider: source.provider,
      relativePath: source.relativePath,
    });

    state.sources[sourceKey] = {
      sourceKey,
      sourceRef: source.relativePath,
      scope: "provider-global",
      provider: source.provider,
      kind: source.kind,
      entryType: source.entryType,
      fingerprint: source.fingerprint,
      decision: toExternalGuidanceDecision(strategy.strategy),
      strategy: strategy.strategy,
      decidedAt,
      sessionRef,
      note: strategy.note,
    };
  }

  state.updatedAt = decidedAt;
  await options.repository.writeExternalGuidanceDecisionState(state);
};

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
      const shouldRecordProviderGlobalDecisions =
        parsedArgs.data.sourceReviewDecision === "not_ok" ||
        (getCreateFlowPhase(existingState?.createIteration ?? effectiveIteration) === "import_selected_guidance" &&
          (parsedArgs.data.apply !== undefined || parsedArgs.data.stepOutcome !== undefined));
      if (shouldRecordProviderGlobalDecisions) {
        await recordProviderGlobalGuidanceDecisions({
          options,
          discoveredSources: extendedContext.discoveredSources,
          confirmedSourceStrategies,
          sessionRef: parsedArgs.data.sessionRef ?? null,
        });
      }
      await options.repository.writeProjectState(identity.projectId, nextState);
      const prompt =
        syncRequired
          ? "Project AI Guidance Bank already exists for this repository and requires synchronization before reuse. Sync only reconciles the existing bank with the current AI Guidance Bank storage version; it does not create or improve project content. Ask the user whether to synchronize it now or postpone it. After that, call `resolve_context` again."
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
            : "Project AI Guidance Bank already exists for this repository and is ready.";
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
