import type { ProviderId, ProviderIntegrationDescriptor } from "../bank/types.js";
import type { CommandRunner, ProviderUninstallResult } from "../providers/types.js";

export type StopOptions = {
  bankRoot?: string;
  commandRunner?: CommandRunner;
  cursorConfigRoot?: string;
  claudeConfigRoot?: string;
};

export type StopResult = {
  bankRoot: string;
  stoppedProviders: ProviderUninstallResult[];
  enabledProviders: ProviderId[];
  integrations: Array<{
    provider: ProviderId;
    descriptor: ProviderIntegrationDescriptor | null;
  }>;
};
