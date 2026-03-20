import { z } from "zod";

import { resolveMemoryBankContext } from "../../core/context/resolveContextService.js";
import type { ToolRegistrar } from "../registerTools.js";

const ResolveContextArgsSchema = z
  .object({
    projectPath: z.string().trim().min(1).describe("Absolute path to the current repository or working directory."),
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
        projectPath: z.string().trim().min(1).describe("Absolute path to the current repository or working directory."),
      },
      outputSchema: {
        status: z.enum(["missing", "ready", "creation_declined"]),
        message: z.string(),
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        projectBankPath: z.string(),
        detectedStacks: z.array(z.string()),
        detectedSignals: z.array(
          z.object({
            name: z.string(),
            source: z.string(),
          }),
        ),
        localGuidance: z.array(
          z.object({
            kind: z.enum(["agents", "cursor", "claude", "codex"]),
            path: z.string(),
          }),
        ),
        referenceProjects: z.array(
          z.object({
            projectId: z.string(),
            projectName: z.string(),
            projectPath: z.string(),
            projectBankPath: z.string(),
            detectedStacks: z.array(z.string()),
            sharedStacks: z.array(z.string()),
          }),
        ),
        rules: z.array(
          z.object({
            layer: z.enum(["shared", "project"]),
            path: z.string(),
            reason: z.string(),
            content: z.string(),
          }),
        ),
        skills: z.array(
          z.object({
            layer: z.enum(["shared", "project"]),
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
    },
  );
};
