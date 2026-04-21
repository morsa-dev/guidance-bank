import { z } from "zod";

import {
  computeProjectBankPostponedUntil,
  createProjectBankState,
  updateProjectBankState,
} from "../../core/bank/project.js";
import { PROJECT_CREATION_STATES } from "../../core/bank/types.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { ToolRegistrar } from "../registerTools.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { AbsoluteProjectPathSchema, SessionRefSchema } from "./sharedSchemas.js";
import { writeToolAuditEvent } from "./auditUtils.js";

const BaseSetProjectStateArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: SessionRefSchema,
    creationState: z
      .enum(PROJECT_CREATION_STATES)
      .describe("Project AI Guidance Bank creation state to persist for this repository."),
    postponeDays: z.number().int().positive().optional(),
    postponedUntil: z.iso.datetime().optional(),
  })
  .strict();

const SetProjectStateArgsSchema = BaseSetProjectStateArgsSchema.superRefine((value, ctx) => {
  if (value.postponeDays !== undefined && value.postponedUntil !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "Use either postponeDays or postponedUntil, not both.",
      path: ["postponedUntil"],
    });
  }

  if (value.creationState === "postponed") {
    return;
  }

  if (value.postponeDays !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "postponeDays is only valid when creationState is postponed.",
      path: ["postponeDays"],
    });
  }

  if (value.postponedUntil !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "postponedUntil is only valid when creationState is postponed.",
      path: ["postponedUntil"],
    });
  }
});

export const registerSetProjectStateTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    MCP_TOOL_NAMES.setProjectState,
    {
      title: "Set Project AI Guidance Bank State",
      description:
        "Persist project-level AI Guidance Bank state such as declined creation, so the agent can avoid asking the user repeatedly.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        projectPath: AbsoluteProjectPathSchema,
        sessionRef: SessionRefSchema,
        creationState: z
          .enum(PROJECT_CREATION_STATES)
          .describe("Project AI Guidance Bank creation state to persist for this repository."),
        postponeDays: z.number().int().positive().optional(),
        postponedUntil: z.iso.datetime().optional(),
      },
      outputSchema: {
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        creationState: z.enum(PROJECT_CREATION_STATES),
        postponedUntil: z.string().nullable(),
      },
    },
    async (args) => {
      const parsedArgs = SetProjectStateArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool ${MCP_TOOL_NAMES.setProjectState}: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
      const existingState = await options.repository.readProjectStateOptional(identity.projectId);
      const now = new Date();
      const postponedUntil =
        parsedArgs.data.creationState === "postponed"
          ? (parsedArgs.data.postponedUntil ??
            computeProjectBankPostponedUntil(now, parsedArgs.data.postponeDays))
          : null;
      const nextState =
        existingState === null
          ? createProjectBankState(parsedArgs.data.creationState, { postponedUntil }, now)
          : updateProjectBankState(existingState, parsedArgs.data.creationState, { postponedUntil }, now);

      await options.repository.writeProjectState(identity.projectId, nextState);
      await writeToolAuditEvent({
        auditLogger: options.auditLogger,
        sessionRef: parsedArgs.data.sessionRef,
        tool: MCP_TOOL_NAMES.setProjectState,
        action: "set_state",
        projectId: identity.projectId,
        projectPath: identity.projectPath,
        details: {
          creationState: nextState.creationState,
          postponedUntil: nextState.postponedUntil,
        },
      });

      const payload = {
        projectId: identity.projectId,
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        creationState: nextState.creationState,
        postponedUntil: nextState.postponedUntil,
      } as const;

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
