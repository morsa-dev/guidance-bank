import { z } from "zod";

import { McpServerConfigSchema } from "../../mcp/config.js";
import { PROVIDER_IDS, type ProviderIntegrationDescriptor } from "./types.js";

export const ProviderIntegrationDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.enum(PROVIDER_IDS),
    displayName: z.string().min(1),
    serverName: z.string().min(1),
    installationMethod: z.literal("provider-cli"),
    scope: z.literal("user"),
    mcpServer: McpServerConfigSchema,
    instructions: z.array(z.string()),
  })
  .strict();

export const parseProviderIntegrationDescriptor = (value: unknown): ProviderIntegrationDescriptor =>
  ProviderIntegrationDescriptorSchema.parse(value);
