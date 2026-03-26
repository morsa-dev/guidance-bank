import { z } from "zod";

import { ENTRY_KINDS, ENTRY_SCOPES } from "../../core/bank/types.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";
import { toSkillDocumentPath, writeEntryAuditEvent } from "./auditUtils.js";

const DeleteEntryArgsSchema = z
  .object({
    scope: z.enum(ENTRY_SCOPES).describe("Delete target: shared user-level entries or project-specific entries."),
    kind: z.enum(ENTRY_KINDS).describe("Whether to delete a thematic rule file or a skill folder."),
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: z.string().trim().min(1).optional().describe("Optional agent session reference for audit logging."),
    path: z
      .string()
      .trim()
      .min(1)
      .describe("Rule file path or skill folder path relative to the selected layer."),
  })
  .strict();

export const registerDeleteEntryTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "delete_entry",
    {
      title: "Delete Memory Bank Entry",
      description:
        "Delete a rule file or skill folder from the shared or project Memory Bank layer. Use with care and only after the user explicitly wants the entry removed.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
      inputSchema: {
        scope: z.enum(ENTRY_SCOPES).describe("Delete target: shared user-level entries or project-specific entries."),
        kind: z.enum(ENTRY_KINDS).describe("Whether to delete a thematic rule file or a skill folder."),
        projectPath: AbsoluteProjectPathSchema,
        sessionRef: z.string().trim().min(1).optional().describe("Optional agent session reference for audit logging."),
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
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool delete_entry: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
      const projectId = parsedArgs.data.scope === "project" ? identity.projectId : undefined;
      if (parsedArgs.data.scope === "project") {
        const projectManifest = await options.repository.readProjectManifestOptional(identity.projectId);
        if (projectManifest === null) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Project Memory Bank does not exist yet. Call create_bank before deleting project-scoped entries.",
              },
            ],
          };
        }
      }

      const beforeContent = await options.repository.readLayerEntryOptional(
        parsedArgs.data.scope,
        parsedArgs.data.kind,
        parsedArgs.data.kind === "skills" ? toSkillDocumentPath(parsedArgs.data.path) : parsedArgs.data.path,
        projectId,
      );

      const result =
        parsedArgs.data.kind === "rules"
          ? await options.repository.deleteRule(
              parsedArgs.data.scope,
              parsedArgs.data.path,
              projectId,
            )
          : await options.repository.deleteSkill(
              parsedArgs.data.scope,
              parsedArgs.data.path,
              projectId,
            );

      if (result.status === "deleted") {
        await writeEntryAuditEvent({
          auditLogger: options.auditLogger,
          sessionRef: parsedArgs.data.sessionRef ?? null,
          tool: "delete_entry",
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
