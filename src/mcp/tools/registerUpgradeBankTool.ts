import { z } from "zod";

import { UpgradeService } from "../../core/upgrade/upgradeService.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
import { SessionRefSchema } from "./sharedSchemas.js";
import { writeToolAuditEvent } from "./auditUtils.js";

const UpgradeBankArgsSchema = z
  .object({
    sessionRef: SessionRefSchema,
  })
  .strict();

export const registerUpgradeBankTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "upgrade_bank",
    {
      title: "Upgrade AI Guidance Bank",
      description:
        "Upgrade AI Guidance Bank to the current storage version, migrate the bank root when needed, remove legacy MCP registrations, and reapply the current integrations.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        sessionRef: SessionRefSchema,
      },
      outputSchema: {
        status: z.enum(["upgraded", "already_current"]),
        bankRoot: z.string(),
        sourceRoot: z.string(),
        migratedBankRoot: z.boolean(),
        previousStorageVersion: z.number().int().positive(),
        storageVersion: z.number().int().positive(),
        enabledProviders: z.array(z.string()),
      },
    },
    async (args) => {
      const parsedArgs = UpgradeBankArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool upgrade_bank: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      try {
        const upgradeService = new UpgradeService();
        const result = await upgradeService.run({
          bankRoot: options.repository.rootPath,
        });

        await writeToolAuditEvent({
          auditLogger: options.auditLogger,
          sessionRef: parsedArgs.data.sessionRef,
          tool: "upgrade_bank",
          action: "upgrade",
          projectId: "bank",
          projectPath: result.bankRoot,
          details: {
            sourceRoot: result.sourceRoot,
            migratedBankRoot: result.migratedBankRoot,
            previousStorageVersion: result.previousStorageVersion,
            storageVersion: result.storageVersion,
            enabledProviders: result.enabledProviders,
          },
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
