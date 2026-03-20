import { access } from "node:fs/promises";
import path from "node:path";

import { delimiter } from "node:path";

import { PROVIDER_DEFINITIONS } from "../../core/providers/providerRegistry.js";
import type { ProviderId } from "../../core/bank/types.js";

export type ProviderAvailability = {
  cliCommand: string;
  displayName: string;
  id: ProviderId;
  available: boolean;
};

const isExecutableAvailable = async (command: string): Promise<boolean> => {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return false;
  }

  for (const directoryPath of pathValue.split(delimiter)) {
    if (!directoryPath) {
      continue;
    }

    const executablePath = path.join(directoryPath, command);
    try {
      await access(executablePath);
      return true;
    } catch {
      continue;
    }
  }

  return false;
};

export const getProviderAvailability = async (): Promise<ProviderAvailability[]> =>
  Promise.all(
    PROVIDER_DEFINITIONS.map(async (provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      cliCommand: provider.cliCommand,
      available: await isExecutableAvailable(provider.cliCommand),
    })),
  );
