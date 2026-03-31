import type { McpServerConfig, ProviderId, ProviderIntegrationDescriptor } from "../core/bank/types.js";

export const MEMORY_BANK_SERVER_NAME = "memory-bank-local";
export const USER_SCOPE = "user";

const withProviderEnv = (provider: ProviderId, mcpServer: McpServerConfig): McpServerConfig => ({
  ...mcpServer,
  env: {
    ...mcpServer.env,
    MB_PROVIDER_ID: provider,
  },
});

export const createProviderDescriptor = (
  provider: ProviderId,
  displayName: string,
  mcpServer: McpServerConfig,
  instructions: string[],
): ProviderIntegrationDescriptor => ({
  schemaVersion: 1,
  provider,
  displayName,
  serverName: MEMORY_BANK_SERVER_NAME,
  installationMethod: "provider-cli",
  scope: USER_SCOPE,
  mcpServer: withProviderEnv(provider, mcpServer),
  instructions,
});
