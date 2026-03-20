import { z } from "zod";

import { ENTRY_KINDS } from "../../core/bank/types.js";
import type { ToolRegistrar } from "../registerTools.js";

const ListEntriesArgsSchema = z
  .object({
    kind: z.enum(ENTRY_KINDS).describe("Entry namespace to query. Allowed values: rules | skills."),
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
      title: "List Memory Bank Entries",
      description: "List rule or skill files from the local Memory Bank.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      inputSchema: {
        kind: z.enum(ENTRY_KINDS).describe("Entry namespace to query. Allowed values: rules | skills."),
        group: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional subdirectory path inside the selected namespace."),
      },
      outputSchema: {
        kind: z.enum(ENTRY_KINDS),
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

      const entries = await options.repository.listEntries(parsedArgs.data.kind, parsedArgs.data.group);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                kind: parsedArgs.data.kind,
                ...(parsedArgs.data.group ? { group: parsedArgs.data.group } : {}),
                entries,
              },
              null,
              2,
            ),
          },
        ],
        structuredContent: {
          kind: parsedArgs.data.kind,
          ...(parsedArgs.data.group ? { group: parsedArgs.data.group } : {}),
          entries,
        },
      };
    },
  );
};
