import { z } from "zod";

import { ENTRY_KINDS, ENTRY_SCOPES } from "../../core/bank/types.js";
import type { ToolRegistrar } from "../registerTools.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { AbsoluteProjectPathSchema, SessionRefSchema } from "./sharedSchemas.js";
import { writeEntryAuditEvent } from "./auditUtils.js";
import {
  buildInvalidToolArgsResult,
  buildStructuredToolResult,
  readEntryBeforeMutation,
  resolveProjectLocalStore,
  resolveScopedMutationContext,
} from "./entryMutationHelpers.js";

const DeleteEntryArgsSchema = z
  .object({
    scope: z.enum(ENTRY_SCOPES).describe("Delete target: shared user-level entries or project-specific entries."),
    kind: z.enum(ENTRY_KINDS).describe("Whether to delete a thematic rule file or a skill folder."),
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: SessionRefSchema,
    path: z
      .string()
      .trim()
      .min(1)
      .describe("Rule file path or skill folder path relative to the selected layer."),
  })
  .strict();

export const registerDeleteEntryTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    MCP_TOOL_NAMES.deleteEntry,
    {
      title: "Delete AI Guidance Bank Entry",
      description:
        "Delete a rule file or skill folder from the shared or project AI Guidance Bank layer. Use with care and only after the user explicitly wants the entry removed.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
      inputSchema: {
        scope: z.enum(ENTRY_SCOPES).describe("Delete target: shared user-level entries or project-specific entries."),
        kind: z.enum(ENTRY_KINDS).describe("Whether to delete a thematic rule file or a skill folder."),
        projectPath: AbsoluteProjectPathSchema,
        sessionRef: SessionRefSchema,
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Rule file path or skill folder path relative to the selected layer."),
      },
      outputSchema: {
        status: z.enum(["deleted", "not_found"]),
        scope: z.enum(ENTRY_SCOPES),
        kind: z.enum(ENTRY_KINDS),
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        path: z.string(),
      },
    },
    async (args) => {
      const parsedArgs = DeleteEntryArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return buildInvalidToolArgsResult(MCP_TOOL_NAMES.deleteEntry, parsedArgs.error);
      }

      const mutationContext = await resolveScopedMutationContext({
        repository: options.repository,
        projectPath: parsedArgs.data.projectPath,
        scope: parsedArgs.data.scope,
        missingProjectMessage: "Project AI Guidance Bank does not exist yet. Call create_bank before deleting project-scoped entries.",
      });
      if ("isError" in mutationContext) {
        return mutationContext;
      }
      const { identity, projectId } = mutationContext;

      const projectLocalStore =
        parsedArgs.data.scope === "project"
          ? await resolveProjectLocalStore(options.repository, parsedArgs.data.projectPath)
          : null;

      const beforeContent = projectLocalStore !== null
        ? await projectLocalStore.readEntryOptional(
            parsedArgs.data.kind,
            parsedArgs.data.kind === "skills"
              ? `${parsedArgs.data.path}/SKILL.md`
              : parsedArgs.data.path,
          )
        : await readEntryBeforeMutation({
            repository: options.repository,
            scope: parsedArgs.data.scope,
            kind: parsedArgs.data.kind,
            path: parsedArgs.data.path,
            ...(projectId ? { projectId } : {}),
          });

      const result = projectLocalStore !== null
        ? parsedArgs.data.kind === "rules"
          ? await projectLocalStore.deleteRule(parsedArgs.data.path)
          : await projectLocalStore.deleteSkill(parsedArgs.data.path)
        : parsedArgs.data.kind === "rules"
          ? await options.repository.deleteRule(parsedArgs.data.scope, parsedArgs.data.path, projectId)
          : await options.repository.deleteSkill(parsedArgs.data.scope, parsedArgs.data.path, projectId);

      if (result.status === "deleted" && projectLocalStore !== null && identity.projectId) {
        await options.repository.touchProjectManifest(identity.projectId);
      }

      if (result.status === "deleted") {
        await writeEntryAuditEvent({
          auditLogger: options.auditLogger,
          sessionRef: parsedArgs.data.sessionRef,
          tool: MCP_TOOL_NAMES.deleteEntry,
          action: "delete",
          scope: parsedArgs.data.scope,
          kind: parsedArgs.data.kind,
          projectId: identity.projectId,
          projectPath: identity.projectPath,
          path: result.path,
          beforeContent,
          afterContent: null,
        });
      }

      const payload = {
        status: result.status,
        scope: parsedArgs.data.scope,
        kind: parsedArgs.data.kind,
        projectId: identity.projectId,
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        path: result.path,
      } as const;

      return buildStructuredToolResult(payload);
    },
  );
};
