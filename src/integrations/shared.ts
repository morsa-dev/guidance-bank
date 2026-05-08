import type { McpServerConfig, ProviderId, ProviderIntegrationDescriptor } from "../core/bank/types.js";

export const GUIDANCEBANK_SERVER_NAME = "guidance-bank";
export const LEGACY_GUIDANCEBANK_SERVER_NAMES = ["guidancebank", "memory-bank-local"] as const;
export const USER_SCOPE = "user";

const withProviderEnv = (provider: ProviderId, mcpServer: McpServerConfig): McpServerConfig => ({
  ...mcpServer,
  env: {
    ...mcpServer.env,
    GUIDANCEBANK_PROVIDER_ID: provider,
  },
});

export const createProviderDescriptor = (
  provider: ProviderId,
  displayName: string,
  mcpServer: McpServerConfig,
  installationMethod: ProviderIntegrationDescriptor["installationMethod"] = "provider-cli",
): ProviderIntegrationDescriptor => ({
  schemaVersion: 1,
  provider,
  displayName,
  serverName: GUIDANCEBANK_SERVER_NAME,
  installationMethod,
  scope: USER_SCOPE,
  mcpServer: withProviderEnv(provider, mcpServer),
});
