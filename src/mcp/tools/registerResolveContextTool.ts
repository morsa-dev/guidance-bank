import { z } from "zod";

import { CREATE_FLOW_PHASES } from "../../core/projects/createFlowPhases.js";
import { resolveGuidanceBankContext } from "../../core/context/resolveContextService.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { AbsoluteProjectPathSchema, SessionRefSchema } from "./sharedSchemas.js";
import { writeToolAuditEvent } from "./auditUtils.js";

const ResolveContextArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: SessionRefSchema,
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
        sessionRef: SessionRefSchema,
      },
      outputSchema: {
        text: z.string(),
        creationState: z.enum(["unknown", "postponed", "declined", "creating", "ready"]).optional(),
        postponedUntil: z.string().nullable().optional(),
        requiredAction: z
          .enum([MCP_TOOL_NAMES.upgradeBank, MCP_TOOL_NAMES.createBank, "continue_create_bank", MCP_TOOL_NAMES.syncBank])
          .optional(),
        recommendedAction: z.enum([MCP_TOOL_NAMES.createBank]).optional(),
        createFlowPhase: z.enum(CREATE_FLOW_PHASES).optional(),
        nextIteration: z.number().int().nonnegative().optional(),
        bankRoot: z.string().optional(),
        sourceRoot: z.string().optional(),
        expectedStorageVersion: z.number().int().positive().optional(),
        storageVersion: z.number().int().positive().optional(),
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
        const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
        const resolvedContext = await resolveGuidanceBankContext({
          repository: options.repository,
          projectPath: parsedArgs.data.projectPath,
        });
        await writeToolAuditEvent({
          auditLogger: options.auditLogger,
          sessionRef: parsedArgs.data.sessionRef,
          tool: MCP_TOOL_NAMES.resolveContext,
          action: "resolve",
          projectId: identity.projectId,
          projectPath: identity.projectPath,
          details: {
            creationState: resolvedContext.creationState ?? null,
            requiredAction: resolvedContext.requiredAction ?? null,
            recommendedAction: resolvedContext.recommendedAction ?? null,
            createFlowPhase: resolvedContext.createFlowPhase ?? null,
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
