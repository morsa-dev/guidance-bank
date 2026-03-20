import type { MemoryBankManifest, McpServerConfig, ProviderId } from "../bank/types.js";
import type { CommandRunner, ProviderInstallResult } from "../providers/types.js";

export type InitOptions = {
  bankRoot?: string;
  commandRunner?: CommandRunner;
  selectedProviders: ProviderId[];
};

export type InitResult = {
  bankRoot: string;
  alreadyExisted: boolean;
  manifest: MemoryBankManifest;
  mcpServerConfig: McpServerConfig;
  integrations: ProviderInstallResult[];
};
