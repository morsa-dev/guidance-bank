import { z } from "zod";

import { ENTRY_KINDS, ENTRY_SCOPES } from "../../core/bank/types.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";

const ReadEntryArgsSchema = z
  .object({
    scope: z.enum(ENTRY_SCOPES).optional().describe("Entry layer to query. Defaults to shared."),
    kind: z.enum(ENTRY_KINDS).describe("Entry namespace to query. Allowed values: rules | skills."),
    projectPath: AbsoluteProjectPathSchema.optional(),
    path: z.string().trim().min(1).describe("Relative file path inside the selected namespace."),
  })
  .strict();

export const registerReadEntryTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "read_entry",
    {
      title: "Read AI Guidance Bank Entry",
      description: "Read a rule or skill file from the local AI Guidance Bank.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      inputSchema: {
        scope: z.enum(ENTRY_SCOPES).optional().describe("Entry layer to query. Defaults to shared."),
        kind: z.enum(ENTRY_KINDS).describe("Entry namespace to query. Allowed values: rules | skills."),
        projectPath: AbsoluteProjectPathSchema.optional(),
        path: z.string().trim().min(1).describe("Relative file path inside the selected namespace."),
      },
      outputSchema: {
        scope: z.enum(ENTRY_SCOPES),
        kind: z.enum(ENTRY_KINDS),
        projectPath: z.string().optional(),
        path: z.string(),
        content: z.string(),
      },
    },
    async (args) => {
      const parsedArgs = ReadEntryArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool read_entry: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      try {
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
        const content =
          scope === "project"
            ? await options.repository.readLayerEntry("project", parsedArgs.data.kind, parsedArgs.data.path, projectId)
            : await options.repository.readEntry(parsedArgs.data.kind, parsedArgs.data.path);
        const payload = {
          scope,
          kind: parsedArgs.data.kind,
          ...(parsedArgs.data.projectPath ? { projectPath: parsedArgs.data.projectPath } : {}),
          path: parsedArgs.data.path,
          content,
        };

        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
          structuredContent: payload,
        };
      } catch (error) {
        if (error instanceof ValidationError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error.message,
              },
            ],
          };
        }

        throw error;
      }
    },
  );
};
