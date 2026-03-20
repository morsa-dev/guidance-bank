import { z } from "zod";

import { ENTRY_SCOPES } from "../../core/bank/types.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { ToolRegistrar } from "../registerTools.js";

const UpsertSkillArgsSchema = z
  .object({
    scope: z.enum(ENTRY_SCOPES).describe("Write target: shared user-level skills or project-specific skills."),
    projectPath: z.string().trim().min(1).describe("Absolute path to the current repository or working directory."),
    path: z
      .string()
      .trim()
      .min(1)
      .describe("Skill folder path relative to the selected skills root, for example adding-feature or stacks/angular/adding-feature."),
    content: z.string().min(1).describe("Full markdown content for the skill SKILL.md file."),
  })
  .strict();

export const registerUpsertSkillTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "upsert_skill",
    {
      title: "Create Or Update Memory Bank Skill",
      description:
        "Create or update a skill folder with a single SKILL.md file in the shared or project Memory Bank layer. If scope is ambiguous, the agent should ask the user before writing.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        scope: z.enum(ENTRY_SCOPES).describe("Write target: shared user-level skills or project-specific skills."),
        projectPath: z.string().trim().min(1).describe("Absolute path to the current repository or working directory."),
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Skill folder path relative to the selected skills root, for example adding-feature or stacks/angular/adding-feature."),
        content: z.string().min(1).describe("Full markdown content for the skill SKILL.md file."),
      },
      outputSchema: {
        status: z.enum(["created", "updated"]),
        scope: z.enum(ENTRY_SCOPES),
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        path: z.string(),
        filePath: z.string(),
        absolutePath: z.string(),
      },
    },
    async (args) => {
      const parsedArgs = UpsertSkillArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool upsert_skill: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
      if (parsedArgs.data.scope === "project") {
        const projectManifest = await options.repository.readProjectManifestOptional(identity.projectId);
        if (projectManifest === null) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Project Memory Bank does not exist yet. Call create_bank before writing project-scoped skills.",
              },
            ],
          };
        }
      }

      const result = await options.repository.upsertSkill(
        parsedArgs.data.scope,
        parsedArgs.data.path,
        parsedArgs.data.content,
        parsedArgs.data.scope === "project" ? identity.projectId : undefined,
      );

      const payload = {
        status: result.status,
        scope: parsedArgs.data.scope,
        projectId: identity.projectId,
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        path: result.path,
        filePath: result.filePath,
        absolutePath: result.absolutePath,
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
