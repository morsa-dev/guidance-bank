import { z } from "zod";

import { ENTRY_SCOPES } from "../../core/bank/types.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";
import { writeEntryAuditEvent } from "./auditUtils.js";

const UpsertRuleArgsSchema = z
  .object({
    scope: z.enum(ENTRY_SCOPES).describe("Write target: shared user-level rules or project-specific rules."),
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: z.string().trim().min(1).optional().describe("Optional agent session reference for audit logging."),
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
        sessionRef: z.string().trim().min(1).optional().describe("Optional agent session reference for audit logging."),
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
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool upsert_rule: ${z.prettifyError(parsedArgs.error)}`,
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
                text: "Project Memory Bank does not exist yet. Call create_bank before writing project-scoped rules.",
              },
            ],
          };
        }
      }

      const beforeContent = await options.repository.readLayerEntryOptional(
        parsedArgs.data.scope,
        "rules",
        parsedArgs.data.path,
        projectId,
      );

      const result = await options.repository.upsertRule(
        parsedArgs.data.scope,
        parsedArgs.data.path,
        parsedArgs.data.content,
        projectId,
      );

      await writeEntryAuditEvent({
        auditLogger: options.auditLogger,
        sessionRef: parsedArgs.data.sessionRef ?? null,
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
