import { z } from "zod";

import { createProjectBankState, updateProjectBankState } from "../../core/bank/project.js";
import { PROJECT_CREATION_STATES } from "../../core/bank/types.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";

const SetProjectStateArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
    creationState: z
      .enum(PROJECT_CREATION_STATES)
      .describe("Project Memory Bank creation state to persist for this repository."),
  })
  .strict();

export const registerSetProjectStateTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "set_project_state",
    {
      title: "Set Project Memory Bank State",
      description:
        "Persist project-level Memory Bank state such as declined creation, so the agent can avoid asking the user repeatedly.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        projectPath: AbsoluteProjectPathSchema,
        creationState: z
          .enum(PROJECT_CREATION_STATES)
          .describe("Project Memory Bank creation state to persist for this repository."),
      },
      outputSchema: {
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        creationState: z.enum(PROJECT_CREATION_STATES),
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
              text: `Invalid arguments for tool set_project_state: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
      const existingState = await options.repository.readProjectStateOptional(identity.projectId);
      const nextState =
        existingState === null
          ? createProjectBankState(parsedArgs.data.creationState)
          : updateProjectBankState(existingState, parsedArgs.data.creationState);

      await options.repository.writeProjectState(identity.projectId, nextState);

      const payload = {
        projectId: identity.projectId,
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        creationState: nextState.creationState,
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
