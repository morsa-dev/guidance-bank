export const PROVIDER_IDS = ["codex", "cursor", "claude-code"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const ENTRY_KINDS = ["rules", "skills"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_SCOPES = ["shared", "project"] as const;
export type EntryScope = (typeof ENTRY_SCOPES)[number];
export const PROJECT_CREATION_STATES = ["unknown", "declined", "ready"] as const;
export type ProjectCreationState = (typeof PROJECT_CREATION_STATES)[number];

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

export type ProjectBankManifest = {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  projectPath: string;
  detectedStacks: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectBankState = {
  schemaVersion: 1;
  creationState: ProjectCreationState;
  updatedAt: string;
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
