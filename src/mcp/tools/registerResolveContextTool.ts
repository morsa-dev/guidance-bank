import { z } from "zod";

import { resolveGuidanceBankContext } from "../../core/context/resolveContextService.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";
import { writeToolAuditEvent } from "./auditUtils.js";

const ResolveContextArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
  })
  .strict();

export const registerResolveContextTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    MCP_TOOL_NAMES.resolveContext,
    {
      title: "Resolve AI Guidance Bank Context",
      description:
        "Primary entrypoint for AI Guidance Bank. Call this before answering or editing in the active target repository to resolve its context, required actions, durable rules, and reusable skills.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      inputSchema: {
        projectPath: AbsoluteProjectPathSchema,
      },
      outputSchema: {
        text: z.string(),
        creationState: z.enum(["unknown", "postponed", "declined", "creating", "ready"]).optional(),
        projectLocalBankDisabled: z.boolean().optional(),
        postponedUntil: z.string().nullable().optional(),
        detectedStacks: z.array(z.string()).optional(),
        rulesCatalog: z
          .array(
            z.object({
              scope: z.enum(["shared", "project"]),
              kind: z.literal("rules"),
              path: z.string(),
              title: z.string(),
              topics: z.array(z.string()),
              description: z.string().nullable().optional(),
            }),
          )
          .optional(),
        skillsCatalog: z
          .array(
            z.object({
              scope: z.enum(["shared", "project"]),
              kind: z.literal("skills"),
              path: z.string(),
              title: z.string(),
              topics: z.array(z.string()),
              description: z.string().nullable().optional(),
            }),
          )
          .optional(),
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
              text: `Invalid arguments for tool ${MCP_TOOL_NAMES.resolveContext}: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      try {
        const providerSession = await options.providerSessionResolver.resolve({
          projectPath: parsedArgs.data.projectPath,
        });
        const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
        const resolvedContext = await resolveGuidanceBankContext({
          repository: options.repository,
          projectPath: parsedArgs.data.projectPath,
        });
        
        // Calculate metrics for token tracking
        const contextText = JSON.stringify(resolvedContext);
        const estimatedTokens = Math.ceil(contextText.length / 3.5);
        const alwaysOnChars = resolvedContext.text?.length ?? 0;
        const entriesCount = (resolvedContext.rulesCatalog?.length ?? 0) + (resolvedContext.skillsCatalog?.length ?? 0);
        
        await writeToolAuditEvent({
          auditLogger: options.auditLogger,
          providerSession,
          tool: MCP_TOOL_NAMES.resolveContext,
          action: "resolve",
          projectId: identity.projectId,
          projectPath: identity.projectPath,
          details: {
            creationState: resolvedContext.creationState ?? null,
            projectLocalBankDisabled: resolvedContext.projectLocalBankDisabled ?? null,
          },
          metrics: {
            contextChars: contextText.length,
            estimatedTokens,
            entriesCount,
            alwaysOnChars,
          },
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
