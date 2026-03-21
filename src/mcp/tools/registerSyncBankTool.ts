import { z } from "zod";

import { SyncService } from "../../core/sync/syncService.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema } from "./sharedSchemas.js";

const SyncBankArgsSchema = z
  .object({
    action: z.enum(["run", "postpone"]).describe("Run an explicit sync now or postpone the sync reminder."),
    projectPath: AbsoluteProjectPathSchema,
  })
  .strict();

export const registerSyncBankTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "sync_bank",
    {
      title: "Sync Memory Bank",
      description:
        "Run an explicit Memory Bank reconcile pass for the current project. Use this when the user asks to resync the bank or when future import or migration flows need a fresh inventory.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        action: z.enum(["run", "postpone"]).describe("Run an explicit sync now or postpone the sync reminder."),
        projectPath: AbsoluteProjectPathSchema,
      },
      outputSchema: {
        action: z.enum(["run", "postpone"]),
        bankRoot: z.string(),
        projectPath: z.string(),
        detectedStacks: z.array(z.string()),
        projectState: z.enum(["unknown", "declined", "ready"]),
        postponedUntil: z.string().nullable(),
        projectManifestUpdated: z.boolean(),
        validatedEntries: z.object({
          shared: z.object({
            rules: z.number().int().nonnegative(),
            skills: z.number().int().nonnegative(),
          }),
          project: z.object({
            rules: z.number().int().nonnegative(),
            skills: z.number().int().nonnegative(),
          }),
        }),
        externalGuidanceSources: z.array(
          z.object({
            kind: z.enum(["agents", "cursor", "claude", "codex"]),
            path: z.string(),
          }),
        ),
      },
    },
    async (args) => {
      const parsedArgs = SyncBankArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool sync_bank: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      try {
        const syncService = new SyncService();
        const result =
          parsedArgs.data.action === "run"
            ? await syncService.run({
                bankRoot: options.repository.rootPath,
                projectPath: parsedArgs.data.projectPath,
              })
            : await syncService.postpone({
                bankRoot: options.repository.rootPath,
                projectPath: parsedArgs.data.projectPath,
              });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
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
