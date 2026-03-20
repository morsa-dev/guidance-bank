import { z } from "zod";

import { ENTRY_KINDS } from "../../core/bank/types.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";

const ReadEntryArgsSchema = z
  .object({
    kind: z.enum(ENTRY_KINDS).describe("Entry namespace to query. Allowed values: rules | skills."),
    path: z.string().trim().min(1).describe("Relative file path inside the selected namespace."),
  })
  .strict();

export const registerReadEntryTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "read_entry",
    {
      title: "Read Memory Bank Entry",
      description: "Read a rule or skill file from the local Memory Bank.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      inputSchema: {
        kind: z.enum(ENTRY_KINDS).describe("Entry namespace to query. Allowed values: rules | skills."),
        path: z.string().trim().min(1).describe("Relative file path inside the selected namespace."),
      },
      outputSchema: {
        kind: z.enum(ENTRY_KINDS),
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
        const content = await options.repository.readEntry(parsedArgs.data.kind, parsedArgs.data.path);

        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
          structuredContent: {
            ...parsedArgs.data,
            content,
          },
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
