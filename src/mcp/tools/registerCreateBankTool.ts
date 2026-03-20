import { z } from "zod";

import { detectProjectContext } from "../../core/context/detectProjectContext.js";
import { createProjectBankManifest, createProjectBankState } from "../../core/bank/project.js";
import { buildCreateBankPrompt } from "../../core/projects/createBankPrompt.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { ToolRegistrar } from "../registerTools.js";

const CreateBankArgsSchema = z
  .object({
    projectPath: z.string().trim().min(1).describe("Absolute path to the current repository or working directory."),
  })
  .strict();

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
        projectPath: z.string().trim().min(1).describe("Absolute path to the current repository or working directory."),
      },
      outputSchema: {
        status: z.enum(["created", "already_exists"]),
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        projectBankPath: z.string(),
        rulesDirectory: z.string(),
        skillsDirectory: z.string(),
        detectedStacks: z.array(z.string()),
        creationPrompt: z.string(),
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

      const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
      const projectContext = await detectProjectContext(identity.projectPath);
      const existingManifest = await options.repository.readProjectManifestOptional(identity.projectId);

      await options.repository.ensureProjectStructure(identity.projectId);

      if (existingManifest === null) {
        await options.repository.writeProjectManifest(
          identity.projectId,
          createProjectBankManifest(identity.projectId, identity.projectName, identity.projectPath),
        );
      }

      await options.repository.writeProjectState(identity.projectId, createProjectBankState("ready"));

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
      });

      const payload = {
        status: existingManifest === null ? "created" : "already_exists",
        projectId: identity.projectId,
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        projectBankPath,
        rulesDirectory,
        skillsDirectory,
        detectedStacks: projectContext.detectedStacks,
        creationPrompt,
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
