import { z } from "zod";

import { PROVIDER_IDS } from "../../core/bank/types.js";
import { resolveMemoryBankContext } from "../../core/context/resolveContextService.js";
import type { ToolRegistrar } from "../registerTools.js";

const ResolveContextArgsSchema = z
  .object({
    cwd: z.string().trim().min(1).describe("Absolute path to the current project or working directory."),
    provider: z
      .enum(PROVIDER_IDS)
      .optional()
      .describe("Active agent provider. Use when provider-specific Memory Bank entries may apply."),
    task: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional short task summary to include in the resolved context payload."),
  })
  .strict();

export const registerResolveContextTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "resolve_context",
    {
      title: "Resolve Memory Bank Context",
      description:
        "Resolve the applicable user-level Memory Bank rules and skills for the current repository. Call this at the start of work in a project, and again when the working directory or task changes materially.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      inputSchema: {
        cwd: z.string().trim().min(1).describe("Absolute path to the current project or working directory."),
        provider: z
          .enum(PROVIDER_IDS)
          .optional()
          .describe("Active agent provider. Use when provider-specific Memory Bank entries may apply."),
        task: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional short task summary to include in the resolved context payload."),
      },
      outputSchema: {
        cwd: z.string(),
        projectName: z.string(),
        provider: z.enum(PROVIDER_IDS).optional(),
        task: z.string().optional(),
        detectedStacks: z.array(z.string()),
        detectedSignals: z.array(
          z.object({
            name: z.string(),
            source: z.string(),
          }),
        ),
        rules: z.array(
          z.object({
            path: z.string(),
            reason: z.string(),
            content: z.string(),
          }),
        ),
        skills: z.array(
          z.object({
            path: z.string(),
            reason: z.string(),
            content: z.string(),
          }),
        ),
        agentInstructions: z.string(),
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

      const resolvedContext = await resolveMemoryBankContext({
        repository: options.repository,
        cwd: parsedArgs.data.cwd,
        ...(parsedArgs.data.provider ? { provider: parsedArgs.data.provider } : {}),
        ...(parsedArgs.data.task ? { task: parsedArgs.data.task } : {}),
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
    },
  );
};
