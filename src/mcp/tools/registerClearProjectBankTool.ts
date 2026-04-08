import { z } from "zod";

import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema, SessionRefSchema } from "./sharedSchemas.js";
import { writeToolAuditEvent } from "./auditUtils.js";

const ClearProjectBankArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: SessionRefSchema,
  })
  .strict();

export const registerClearProjectBankTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "clear_project_bank",
    {
      title: "Clear Project Memory Bank",
      description:
        "Delete the current repository's entire project-scoped Memory Bank so the project can be recreated from scratch. Shared entries are not affected.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
      inputSchema: {
        projectPath: AbsoluteProjectPathSchema,
        sessionRef: SessionRefSchema,
      },
      outputSchema: {
        status: z.enum(["cleared", "not_found"]),
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        projectBankPath: z.string(),
      },
    },
    async (args) => {
      const parsedArgs = ClearProjectBankArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool clear_project_bank: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
      const deleted = await options.repository.deleteProjectBank(identity.projectId);
      await writeToolAuditEvent({
        auditLogger: options.auditLogger,
        sessionRef: parsedArgs.data.sessionRef,
        tool: "clear_project_bank",
        action: "clear",
        projectId: identity.projectId,
        projectPath: identity.projectPath,
        details: {
          status: deleted ? "cleared" : "not_found",
        },
      });
      const payload = {
        status: deleted ? "cleared" : "not_found",
        projectId: identity.projectId,
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        projectBankPath: options.repository.paths.projectDirectory(identity.projectId),
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
