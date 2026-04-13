import { z } from "zod";

import { ENTRY_SCOPES } from "../../core/bank/types.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema, SessionRefSchema } from "./sharedSchemas.js";
import { writeEntryAuditEvent } from "./auditUtils.js";
import {
  buildInvalidToolArgsResult,
  buildStructuredToolResult,
  readEntryBeforeMutation,
  resolveScopedMutationContext,
} from "./entryMutationHelpers.js";

const UpsertSkillArgsSchema = z
  .object({
    scope: z.enum(ENTRY_SCOPES).describe("Write target: shared user-level skills or project-specific skills."),
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: SessionRefSchema,
    path: z
      .string()
      .trim()
      .min(1)
      .describe("Skill folder path relative to the selected skills root, for example adding-feature or stacks/angular/adding-feature."),
    content: z
      .string()
      .min(1)
      .describe("Full markdown content for the skill SKILL.md file, including canonical frontmatter."),
  })
  .strict();

export const registerUpsertSkillTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "upsert_skill",
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
        sessionRef: SessionRefSchema,
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Skill folder path relative to the selected skills root, for example adding-feature or stacks/angular/adding-feature."),
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
        return buildInvalidToolArgsResult("upsert_skill", parsedArgs.error);
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

      const beforeContent = await readEntryBeforeMutation({
        repository: options.repository,
        scope: parsedArgs.data.scope,
        kind: "skills",
        path: parsedArgs.data.path,
        ...(projectId ? { projectId } : {}),
      });

      const result = await options.repository.upsertSkill(
        parsedArgs.data.scope,
        parsedArgs.data.path,
        parsedArgs.data.content,
        projectId,
      );

      await writeEntryAuditEvent({
        auditLogger: options.auditLogger,
        sessionRef: parsedArgs.data.sessionRef,
        tool: "upsert_skill",
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
