export const PROVIDER_IDS = ["codex", "cursor", "claude-code"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const ENTRY_KINDS = ["rules", "skills"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export type MemoryBankManifest = {
  schemaVersion: 1;
  storageVersion: 1;
  bankId: string;
  createdAt: string;
  updatedAt: string;
  enabledProviders: ProviderId[];
  defaultMcpTransport: "stdio";
};

export type McpServerConfig = {
  schemaVersion: 1;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type ProviderIntegrationDescriptor = {
  schemaVersion: 1;
  provider: ProviderId;
  displayName: string;
  serverName: string;
  installationMethod: "provider-cli";
  scope: "user";
  mcpServer: McpServerConfig;
  instructions: string[];
};

export type ListedEntry = {
  path: string;
};
