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
  cursorConfigRoot?: string;
};

export type ProviderInstallResult = {
  descriptor: ProviderIntegrationDescriptor;
  command: CommandSpec | null;
  action: "installed" | "skipped" | "reconfigured";
};

export type ProviderUninstallResult = {
  provider: ProviderId;
  displayName: string;
  command: CommandSpec | null;
  action: "removed" | "already_absent";
};

export type ProviderDefinition = {
  id: ProviderId;
  displayName: string;
  cliCommand: string;
  unavailableMessage: string;
  isAvailable?: () => Promise<boolean>;
  install: (context: ProviderInstallerContext) => Promise<ProviderInstallResult>;
  uninstall: (context: ProviderInstallerContext) => Promise<ProviderUninstallResult>;
};
