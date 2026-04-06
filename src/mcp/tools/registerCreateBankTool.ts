import { z } from "zod";

import {
  createProjectBankManifest,
} from "../../core/bank/project.js";
import { buildCreateBankPrompt } from "../../core/projects/createBankPrompt.js";
import { resolveCreateBankFlowContext } from "../../core/projects/createBankFlow.js";
import { discoverCurrentProjectBank } from "../../core/projects/discoverCurrentProjectBank.js";
import {
  buildCreateBankIterationPrompt,
  buildReadyProjectBankPrompt,
} from "../../core/projects/createBankIterationPrompt.js";
import { getCreateFlowPhase } from "../../core/projects/createFlowPhases.js";
import type { ToolRegistrar } from "../registerTools.js";
import { applyCreateBankChanges } from "./createBankApply.js";
import {
  buildCreateBankResponseText,
  getCreateBankApplyBlockedMessage,
  normalizeApplyDeletions,
  normalizeApplyWrites,
  resolveNextCreateBankState,
  shouldWarnAboutIterationMismatch,
} from "./createBankToolRuntime.js";
import {
  CreateBankArgsSchema,
  CreateBankInputShape,
  CreateBankOutputShape,
} from "./createBankToolSchemas.js";

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
      const applyBlockedMessage = getCreateBankApplyBlockedMessage({
        hasApply: parsedArgs.data.apply !== undefined,
        syncRequired,
        improvementEntryPoint,
        stepCompletionRequired,
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

      const nextState = resolveNextCreateBankState({
        existingManifest,
        existingState,
        shouldTrackCreateFlow,
        nextCreationState,
        manifestStorageVersion,
        effectiveIteration,
      });
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
      const creationPrompt =
        effectiveIteration === 0
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
        text: buildCreateBankResponseText({
          syncRequired,
          applyResults,
          stepCompletionRequired,
          nextIteration,
          improvementEntryPoint,
          mustContinue,
          completedFlowThisCall,
          phase,
        }),
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
