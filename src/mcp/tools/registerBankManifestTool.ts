import { z } from "zod";

import { type MemoryBankManifest, PROVIDER_IDS } from "../../core/bank/types.js";
import type { ToolRegistrar } from "../registerTools.js";

const emptyInputSchema = z.object({}).strict();

export const registerBankManifestTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "bank_manifest",
    {
      title: "Read AI Guidance Bank Manifest",
      description: "Return AI Guidance Bank metadata and enabled providers.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      inputSchema: {},
      outputSchema: {
        schemaVersion: z.literal(1),
        storageVersion: z.literal(1),
        bankId: z.uuid(),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        enabledProviders: z.array(z.enum(PROVIDER_IDS)),
        defaultMcpTransport: z.literal("stdio"),
      },
    },
    async (args) => {
      const parsedArgs = emptyInputSchema.safeParse(args ?? {});
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool bank_manifest: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      const manifest = await options.repository.readManifest();
      const typedManifest: MemoryBankManifest = manifest;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(typedManifest, null, 2),
          },
        ],
        structuredContent: typedManifest,
      };
    },
  );
};
