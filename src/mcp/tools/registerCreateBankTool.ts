import { z } from "zod";

import { detectProjectContext } from "../../core/context/detectProjectContext.js";
import {
  createProjectBankManifest,
  createProjectBankState,
  markProjectBankSynced,
  setProjectBankCreateIteration,
} from "../../core/bank/project.js";
import { buildCreateBankPrompt } from "../../core/projects/createBankPrompt.js";
import { buildCreateBankIterationPrompt } from "../../core/projects/createBankIterationPrompt.js";
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
        existingState.createIteration !== null &&
        existingState.createIteration !== requestedIteration
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

      if (existingManifest === null) {
        nextState = markProjectBankSynced(createProjectBankState("ready"), manifest.storageVersion);
      }

      if (nextState === null) {
        nextState = createProjectBankState("ready");
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
      const prompt = syncRequired
        ? "Project Memory Bank already exists for this repository and requires synchronization before reuse. Ask the user whether to synchronize it now or postpone it. After that, call `resolve_context` again."
        : buildCreateBankIterationPrompt({
            iteration: requestedIteration,
            projectName: identity.projectName,
            projectPath: identity.projectPath,
            projectBankPath,
            rulesDirectory,
            skillsDirectory,
            detectedStacks: projectContext.detectedStacks,
            selectedReferenceProjects,
          });

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
        selectedReferenceProjects,
        prompt,
        creationPrompt,
        text:
          existingManifest === null
            ? "Project Memory Bank scaffold created successfully."
            : syncRequired
              ? "Project Memory Bank already exists for this repository and requires synchronization before reuse. Ask the user whether to synchronize it now or postpone it."
              : "Project Memory Bank already exists for this repository and is ready for further updates through the normal Memory Bank mutation tools.",
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
