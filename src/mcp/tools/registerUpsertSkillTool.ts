import { z } from "zod";

import { ENTRY_SCOPES } from "../../core/bank/types.js";
import type { ToolRegistrar } from "../registerTools.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";
import { writeEntryAuditEvent } from "./auditUtils.js";
import {
  buildInvalidToolArgsResult,
  buildStructuredToolResult,
  readEntryBeforeMutation,
  resolveProjectLocalStore,
  resolveScopedMutationContext,
} from "./entryMutationHelpers.js";

const UpsertSkillArgsSchema = z
  .object({
    scope: z.enum(ENTRY_SCOPES).describe("Write target: shared user-level skills or project-specific skills."),
    projectPath: AbsoluteProjectPathSchema,
    path: z
      .string()
      .trim()
      .min(1)
      .describe("Skill folder path relative to the selected skills root, for example adding-feature or component-audit."),
    content: z
      .string()
      .min(1)
      .describe("Full markdown content for the skill SKILL.md file, including canonical frontmatter."),
  })
  .strict();

export const registerUpsertSkillTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    MCP_TOOL_NAMES.upsertSkill,
    {
      title: "Create Or Update AI Guidance Bank Skill",
      description:
        "Create or update a skill folder with a single SKILL.md file in the shared or project AI Guidance Bank layer. If scope is ambiguous, the agent should ask the user before writing.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        scope: z.enum(ENTRY_SCOPES).describe("Write target: shared user-level skills or project-specific skills."),
        projectPath: AbsoluteProjectPathSchema,
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Skill folder path relative to the selected skills root, for example adding-feature or component-audit."),
        content: z
          .string()
          .min(1)
          .describe("Full markdown content for the skill SKILL.md file, including canonical frontmatter."),
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
        return buildInvalidToolArgsResult(MCP_TOOL_NAMES.upsertSkill, parsedArgs.error);
      }

      const mutationContext = await resolveScopedMutationContext({
        repository: options.repository,
        projectPath: parsedArgs.data.projectPath,
        scope: parsedArgs.data.scope,
        missingProjectMessage: "Project AI Guidance Bank does not exist yet. Call create_bank before writing project-scoped skills.",
      });
      if ("isError" in mutationContext) {
        return mutationContext;
      }
      const { identity, projectId } = mutationContext;
      const providerSession = await options.providerSessionResolver.resolve({
        projectPath: parsedArgs.data.projectPath,
      });

      const projectLocalStore =
        parsedArgs.data.scope === "project"
          ? await resolveProjectLocalStore(options.repository, parsedArgs.data.projectPath)
          : null;

      const beforeContent = projectLocalStore !== null
        ? await projectLocalStore.readEntryOptional("skills", `${parsedArgs.data.path}/SKILL.md`)
        : await readEntryBeforeMutation({
            repository: options.repository,
            scope: parsedArgs.data.scope,
            kind: "skills",
            path: parsedArgs.data.path,
            ...(projectId ? { projectId } : {}),
          });

      const result = projectLocalStore !== null
        ? await projectLocalStore.upsertSkill(parsedArgs.data.path, parsedArgs.data.content)
        : await options.repository.upsertSkill(
            parsedArgs.data.scope,
            parsedArgs.data.path,
            parsedArgs.data.content,
            projectId,
          );

      if (projectLocalStore !== null && identity.projectId) {
        await options.repository.touchProjectManifest(identity.projectId);
      }

      await writeEntryAuditEvent({
        auditLogger: options.auditLogger,
        providerSession,
        tool: MCP_TOOL_NAMES.upsertSkill,
        action: "upsert",
        scope: parsedArgs.data.scope,
        kind: "skills",
        projectId: identity.projectId,
        projectPath: identity.projectPath,
        path: result.path,
        beforeContent,
        afterContent: parsedArgs.data.content,
      });

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

      return buildStructuredToolResult(payload);
    },
  );
};
