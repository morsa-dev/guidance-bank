import { z } from "zod";

import { resolveMemoryBankContext } from "../../core/context/resolveContextService.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";

const ResolveContextArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
  })
  .strict();

export const registerResolveContextTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "resolve_context",
    {
      title: "Resolve Memory Bank Context",
      description:
        "Resolve the primary Memory Bank context for the current repository. Call this at the start of work in a project, and again when the working directory changes materially.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      inputSchema: {
        projectPath: AbsoluteProjectPathSchema,
      },
      outputSchema: {
        text: z.string(),
        referenceProjects: z
          .array(
          z.object({
            projectId: z.string(),
            projectName: z.string(),
            projectPath: z.string(),
            projectBankPath: z.string(),
            detectedStacks: z.array(z.string()),
            sharedStacks: z.array(z.string()),
          }),
          )
          .optional(),
      },
    },
    async (args) => {
      const parsedArgs = ResolveContextArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool resolve_context: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      try {
        const resolvedContext = await resolveMemoryBankContext({
          repository: options.repository,
          projectPath: parsedArgs.data.projectPath,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(resolvedContext, null, 2),
            },
          ],
          structuredContent: resolvedContext,
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
