import { z } from "zod";

import { CREATE_FLOW_PHASES } from "../../core/projects/createFlowPhases.js";
import { resolveMemoryBankContext } from "../../core/context/resolveContextService.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
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
        sessionRef: SessionRefSchema,
      },
      outputSchema: {
        text: z.string(),
        creationState: z.enum(["unknown", "declined", "creating", "ready"]).optional(),
        requiredAction: z.enum(["create_bank", "continue_create_bank", "sync_bank"]).optional(),
        createFlowPhase: z.enum(CREATE_FLOW_PHASES).optional(),
        nextIteration: z.number().int().nonnegative().optional(),
        detectedStacks: z.array(z.string()).optional(),
        alwaysOnRules: z
          .array(
            z.object({
              scope: z.enum(["shared", "project"]),
              path: z.string(),
              id: z.string(),
              title: z.string(),
              topics: z.array(z.string()),
              content: z.string(),
            }),
          )
          .optional(),
        rulesCatalog: z
          .array(
            z.object({
              scope: z.enum(["shared", "project"]),
              kind: z.literal("rules"),
              path: z.string(),
              id: z.string(),
              title: z.string(),
              stacks: z.array(z.string()),
              topics: z.array(z.string()),
              preview: z.string().nullable().optional(),
            }),
          )
          .optional(),
        skillsCatalog: z
          .array(
            z.object({
              scope: z.enum(["shared", "project"]),
              kind: z.literal("skills"),
              path: z.string(),
              id: z.string(),
              title: z.string(),
              stacks: z.array(z.string()),
              topics: z.array(z.string()),
              description: z.string().optional(),
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
              text: `Invalid arguments for tool resolve_context: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      try {
        const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
        const resolvedContext = await resolveMemoryBankContext({
          repository: options.repository,
          projectPath: parsedArgs.data.projectPath,
        });
        await writeToolAuditEvent({
          auditLogger: options.auditLogger,
          sessionRef: parsedArgs.data.sessionRef,
          tool: "resolve_context",
          action: "resolve",
          projectId: identity.projectId,
          projectPath: identity.projectPath,
          details: {
            creationState: resolvedContext.creationState ?? null,
            requiredAction: resolvedContext.requiredAction ?? null,
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
