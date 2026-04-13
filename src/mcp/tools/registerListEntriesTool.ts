import { z } from "zod";

import { ENTRY_KINDS, ENTRY_SCOPES } from "../../core/bank/types.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";

const ListEntriesArgsSchema = z
  .object({
    scope: z.enum(ENTRY_SCOPES).optional().describe("Entry layer to query. Defaults to shared."),
    kind: z.enum(ENTRY_KINDS).describe("Entry namespace to query. Allowed values: rules | skills."),
    projectPath: AbsoluteProjectPathSchema.optional(),
    group: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional subdirectory path inside the selected namespace."),
  })
  .strict();

export const registerListEntriesTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "list_entries",
    {
      title: "List AI Guidance Bank Entries",
      description: "List rule or skill files from the local AI Guidance Bank.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      inputSchema: {
        scope: z.enum(ENTRY_SCOPES).optional().describe("Entry layer to query. Defaults to shared."),
        kind: z.enum(ENTRY_KINDS).describe("Entry namespace to query. Allowed values: rules | skills."),
        projectPath: AbsoluteProjectPathSchema.optional(),
        group: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional subdirectory path inside the selected namespace."),
      },
      outputSchema: {
        scope: z.enum(ENTRY_SCOPES),
        kind: z.enum(ENTRY_KINDS),
        projectPath: z.string().optional(),
        group: z.string().optional(),
        entries: z.array(
          z.object({
            path: z.string(),
          }),
        ),
      },
    },
    async (args) => {
      const parsedArgs = ListEntriesArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool list_entries: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      const scope = parsedArgs.data.scope ?? "shared";
      if (scope === "project" && parsedArgs.data.projectPath === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "projectPath is required when scope is project.",
            },
          ],
        };
      }

      const projectId =
        scope === "project" && parsedArgs.data.projectPath
          ? resolveProjectIdentity(parsedArgs.data.projectPath).projectId
          : undefined;
      const entries =
        scope === "project"
          ? await options.repository.listLayerEntries("project", parsedArgs.data.kind, projectId, parsedArgs.data.group)
          : await options.repository.listEntries(parsedArgs.data.kind, parsedArgs.data.group);
      const payload = {
        scope,
        kind: parsedArgs.data.kind,
        ...(parsedArgs.data.projectPath ? { projectPath: parsedArgs.data.projectPath } : {}),
        ...(parsedArgs.data.group ? { group: parsedArgs.data.group } : {}),
        entries,
      };

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
