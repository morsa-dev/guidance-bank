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

const UpsertRuleArgsSchema = z
  .object({
    scope: z.enum(ENTRY_SCOPES).describe("Write target: shared user-level rules or project-specific rules."),
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: SessionRefSchema,
    path: z
      .string()
      .trim()
      .min(1)
      .describe("Rule file path relative to the selected rules root, for example topics/architecture.md."),
    content: z
      .string()
      .min(1)
      .describe("Full markdown content for the thematic rule file, including canonical frontmatter."),
  })
  .strict();

export const registerUpsertRuleTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "upsert_rule",
    {
      title: "Create Or Update Memory Bank Rule File",
      description:
        "Create or update a thematic rule file in the shared or project Memory Bank layer. If scope is ambiguous, the agent should ask the user before writing.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        scope: z.enum(ENTRY_SCOPES).describe("Write target: shared user-level rules or project-specific rules."),
        projectPath: AbsoluteProjectPathSchema,
        sessionRef: SessionRefSchema,
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Rule file path relative to the selected rules root, for example topics/architecture.md."),
        content: z
          .string()
          .min(1)
          .describe("Full markdown content for the thematic rule file, including canonical frontmatter."),
      },
      outputSchema: {
        status: z.enum(["created", "updated"]),
        scope: z.enum(ENTRY_SCOPES),
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        path: z.string(),
        absolutePath: z.string(),
      },
    },
    async (args) => {
      const parsedArgs = UpsertRuleArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return buildInvalidToolArgsResult("upsert_rule", parsedArgs.error);
      }

      const mutationContext = await resolveScopedMutationContext({
        repository: options.repository,
        projectPath: parsedArgs.data.projectPath,
        scope: parsedArgs.data.scope,
        missingProjectMessage: "Project Memory Bank does not exist yet. Call create_bank before writing project-scoped rules.",
      });
      if ("isError" in mutationContext) {
        return mutationContext;
      }
      const { identity, projectId } = mutationContext;

      const beforeContent = await readEntryBeforeMutation({
        repository: options.repository,
        scope: parsedArgs.data.scope,
        kind: "rules",
        path: parsedArgs.data.path,
        ...(projectId ? { projectId } : {}),
      });

      const result = await options.repository.upsertRule(
        parsedArgs.data.scope,
        parsedArgs.data.path,
        parsedArgs.data.content,
        projectId,
      );

      await writeEntryAuditEvent({
        auditLogger: options.auditLogger,
        sessionRef: parsedArgs.data.sessionRef,
        tool: "upsert_rule",
        action: "upsert",
        scope: parsedArgs.data.scope,
        kind: "rules",
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
        absolutePath: result.absolutePath,
      } as const;

      return buildStructuredToolResult(payload);
    },
  );
};
