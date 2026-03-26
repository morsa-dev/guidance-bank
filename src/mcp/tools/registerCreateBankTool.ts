import { z } from "zod";

import { detectProjectContext } from "../../core/context/detectProjectContext.js";
import {
  createProjectBankManifest,
  createProjectBankState,
  markProjectBankSynced,
  setProjectBankCreateIteration,
} from "../../core/bank/project.js";
import { buildCreateBankPrompt } from "../../core/projects/createBankPrompt.js";
import { discoverExistingGuidance } from "../../core/projects/discoverExistingGuidance.js";
import { discoverProjectEvidence } from "../../core/projects/discoverProjectEvidence.js";
import { discoverRecentCommits } from "../../core/projects/discoverRecentCommits.js";
import {
  buildCreateBankIterationPrompt,
  getNextCreateFlowIteration,
  isCreateFlowComplete,
} from "../../core/projects/createBankIterationPrompt.js";
import { findReferenceProjects } from "../../core/projects/findReferenceProjects.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { ProjectBankState } from "../../core/bank/types.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";

const CreateBankArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
    iteration: z.number().int().nonnegative().optional(),
    referenceProjectIds: z
      .array(z.string().trim().min(1))
      .max(5)
      .optional()
      .describe("Optional project ids of existing Memory Banks to use as reference material for the new project bank."),
  })
  .strict();

const requiresSync = (
  projectState: ProjectBankState | null,
  expectedStorageVersion: number,
): boolean => projectState?.lastSyncedStorageVersion !== expectedStorageVersion;

const shouldWarnAboutIterationMismatch = (
  storedIteration: number | null,
  requestedIteration: number,
): boolean => {
  if (storedIteration === null) {
    return false;
  }

  if (requestedIteration === storedIteration || requestedIteration === storedIteration + 1) {
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
        recentCommits: z.array(
          z.object({
            shortHash: z.string(),
            subject: z.string(),
          }),
        ),
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
        mustContinue: z.boolean(),
        nextIteration: z.number().int().nonnegative().nullable(),
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
      const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
      const projectContext = await detectProjectContext(identity.projectPath);
      const discoveredSources = await discoverExistingGuidance(identity.projectPath);
      const projectEvidence = await discoverProjectEvidence(identity.projectPath);
      const recentCommits = await discoverRecentCommits(identity.projectPath);
      const referenceProjects = await findReferenceProjects({
        repository: options.repository,
        currentProjectId: identity.projectId,
        detectedStacks: projectContext.detectedStacks,
      });
      const unknownReferenceIds =
        parsedArgs.data.referenceProjectIds?.filter(
          (referenceProjectId) => !referenceProjects.some((project) => project.projectId === referenceProjectId),
        ) ?? [];

      if (unknownReferenceIds.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown reference project ids for tool create_bank: ${unknownReferenceIds.join(", ")}`,
            },
          ],
        };
      }

      const selectedReferenceProjects = parsedArgs.data.referenceProjectIds
        ? referenceProjects.filter((project) => parsedArgs.data.referenceProjectIds?.includes(project.projectId))
        : [];
      const existingManifest = await options.repository.readProjectManifestOptional(identity.projectId);
      const existingState = await options.repository.readProjectStateOptional(identity.projectId);

      if (
        existingState !== null &&
        shouldWarnAboutIterationMismatch(existingState.createIteration, requestedIteration)
      ) {
        console.warn(
          `create_bank iteration mismatch for project ${identity.projectId}: stored=${existingState.createIteration}, requested=${requestedIteration}. Overwriting stored iteration.`,
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

      const manifest = await options.repository.readManifest();
      let nextState = existingState;
      const isFlowComplete = isCreateFlowComplete(requestedIteration);
      const shouldTrackCreateFlow =
        existingManifest === null ||
        existingState?.creationState === "creating" ||
        existingState?.creationState === "declined";
      const nextCreationState = shouldTrackCreateFlow ? (isFlowComplete ? "ready" : "creating") : "ready";

      if (existingManifest === null) {
        nextState = markProjectBankSynced(createProjectBankState(nextCreationState), manifest.storageVersion);
      } else if (nextState === null) {
        nextState = createProjectBankState(nextCreationState);
      } else if (shouldTrackCreateFlow) {
        nextState = {
          ...nextState,
          creationState: nextCreationState,
        };
      }

      nextState = setProjectBankCreateIteration(nextState, requestedIteration);
      await options.repository.writeProjectState(identity.projectId, nextState);

      const projectBankPath = options.repository.paths.projectDirectory(identity.projectId);
      const rulesDirectory = options.repository.paths.projectRulesDirectory(identity.projectId);
      const skillsDirectory = options.repository.paths.projectSkillsDirectory(identity.projectId);
      const creationPrompt = buildCreateBankPrompt({
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        projectBankPath,
        rulesDirectory,
        skillsDirectory,
        detectedStacks: projectContext.detectedStacks,
        selectedReferenceProjects,
      });
      const syncRequired = existingManifest === null ? false : requiresSync(existingState, manifest.storageVersion);
      const mustContinue = !syncRequired && nextState.creationState === "creating";
      const nextIteration = mustContinue ? getNextCreateFlowIteration(requestedIteration) : null;
      const completedFlowThisCall = !mustContinue && existingState?.creationState === "creating" && isFlowComplete;
      const prompt =
        syncRequired
          ? "Project Memory Bank already exists for this repository and requires synchronization before reuse. Ask the user whether to synchronize it now or postpone it. After that, call `resolve_context` again."
          : mustContinue || completedFlowThisCall
            ? buildCreateBankIterationPrompt({
                iteration: requestedIteration,
                projectName: identity.projectName,
                projectPath: identity.projectPath,
                projectBankPath,
                rulesDirectory,
                skillsDirectory,
                detectedStacks: projectContext.detectedStacks,
                selectedReferenceProjects,
                discoveredSources,
                projectEvidence,
                recentCommits,
              })
            : "Project Memory Bank already exists for this repository and is ready.";

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
        iteration: requestedIteration,
        discoveredSources,
        projectEvidence,
        recentCommits,
        selectedReferenceProjects,
        creationState: nextState.creationState,
        mustContinue,
        nextIteration,
        prompt,
        creationPrompt,
        text:
          syncRequired
            ? "Call sync_bank."
            : mustContinue && nextIteration !== null
              ? `Call create_bank with iteration: ${nextIteration}.`
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
