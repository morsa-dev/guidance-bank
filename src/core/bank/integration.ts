import { z } from "zod";

import { McpServerConfigSchema } from "../../mcp/config.js";
import { PROVIDER_IDS, type ProviderIntegrationDescriptor } from "./types.js";

export const ProviderIntegrationDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.enum(PROVIDER_IDS),
    displayName: z.string().min(1),
    serverName: z.string().min(1),
    installationMethod: z.enum(["provider-cli", "config-file"]),
    scope: z.literal("user"),
    mcpServer: McpServerConfigSchema,
  })
  .catchall(z.unknown());

export const parseProviderIntegrationDescriptor = (value: unknown): ProviderIntegrationDescriptor => {
  const parsed = ProviderIntegrationDescriptorSchema.parse(value);

  return {
    schemaVersion: parsed.schemaVersion,
    provider: parsed.provider,
    displayName: parsed.displayName,
    serverName: parsed.serverName,
    installationMethod: parsed.installationMethod,
    scope: parsed.scope,
    mcpServer: parsed.mcpServer,
  };
};
