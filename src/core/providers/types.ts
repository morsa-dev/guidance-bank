import type { McpServerConfig, ProviderId, ProviderIntegrationDescriptor } from "../bank/types.js";

export type CommandSpec = {
  command: string;
  args: string[];
};

export type CommandRunResult = CommandSpec & {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (spec: CommandSpec) => Promise<CommandRunResult>;

export type ProviderInstallerContext = {
  bankRoot: string;
  commandRunner: CommandRunner;
  existingDescriptor: ProviderIntegrationDescriptor | null;
  mcpServerConfig: McpServerConfig;
};

export type ProviderInstallResult = {
  descriptor: ProviderIntegrationDescriptor;
  command: CommandSpec;
  action: "installed" | "skipped" | "reconfigured";
};

export type ProviderDefinition = {
  id: ProviderId;
  displayName: string;
  install: (context: ProviderInstallerContext) => Promise<ProviderInstallResult>;
};
