import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { PROVIDER_DEFINITIONS } from "../../core/providers/providerRegistry.js";
import type { ProviderId } from "../../core/bank/types.js";
import { UserInputError } from "../../shared/errors.js";
import { getProviderAvailability, type ProviderAvailability } from "./providerAvailability.js";

const selectionSeparators = /[\s,]+/;

const parseSelection = (value: string, availableProviders: readonly ProviderAvailability[]): ProviderId[] => {
  const trimmed = value.trim();
  const availableProviderIds = new Set(availableProviders.filter((provider) => provider.available).map((provider) => provider.id));

  if (!trimmed) {
    const defaults = PROVIDER_DEFINITIONS.filter((provider) => availableProviderIds.has(provider.id)).map((provider) => provider.id);
    if (defaults.length === 0) {
      throw new UserInputError("No supported provider CLIs were found on PATH. Install at least one provider CLI first.");
    }

    return defaults;
  }

  const loweredValue = trimmed.toLowerCase();
  if (loweredValue === "all" || loweredValue === "available") {
    const defaults = PROVIDER_DEFINITIONS.filter((provider) => availableProviderIds.has(provider.id)).map((provider) => provider.id);
    if (defaults.length === 0) {
      throw new UserInputError("No supported provider CLIs were found on PATH. Install at least one provider CLI first.");
    }

    return defaults;
  }

  const selectedProviders = new Set<ProviderId>();
  const tokens = trimmed.split(selectionSeparators).filter(Boolean);

  for (const token of tokens) {
    const lowerToken = token.toLowerCase();
    const numericIndex = Number.parseInt(lowerToken, 10);
    const providerByIndex =
      Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= PROVIDER_DEFINITIONS.length
        ? PROVIDER_DEFINITIONS[numericIndex - 1]
        : undefined;

    if (providerByIndex) {
      if (!availableProviderIds.has(providerByIndex.id)) {
        const unavailableProvider = availableProviders.find((provider) => provider.id === providerByIndex.id);
        throw new UserInputError(unavailableProvider?.unavailableMessage ?? `${providerByIndex.displayName} is not available.`);
      }

      selectedProviders.add(providerByIndex.id);
      continue;
    }

    const providerByName = PROVIDER_DEFINITIONS.find((provider) => {
      const normalizedLabel = provider.displayName.toLowerCase().replaceAll(" ", "-");
      return lowerToken === provider.id || lowerToken === normalizedLabel;
    });

    if (providerByName) {
      if (!availableProviderIds.has(providerByName.id)) {
        const unavailableProvider = availableProviders.find((provider) => provider.id === providerByName.id);
        throw new UserInputError(unavailableProvider?.unavailableMessage ?? `${providerByName.displayName} is not available.`);
      }

      selectedProviders.add(providerByName.id);
      continue;
    }

    throw new UserInputError(`Unsupported provider selection: ${token}`);
  }

  if (selectedProviders.size === 0) {
    throw new UserInputError("You must select at least one provider.");
  }

  return [...selectedProviders];
};

export const promptForProviders = async (): Promise<ProviderId[]> => {
  if (!input.isTTY || !output.isTTY) {
    throw new UserInputError("gbank init requires an interactive terminal in the current MVP.");
  }

  const availability = await getProviderAvailability();

  output.write("Select providers to enable for AI Guidance Bank MCP:\n");
  for (const [index, provider] of availability.entries()) {
    output.write(`${index + 1}. ${provider.displayName} [${provider.available ? "available" : "not found"}]\n`);
  }
  output.write('Press Enter to select all available providers. Type numbers, ids, or "all".\n');

  const readline = createInterface({ input, output });

  try {
    while (true) {
      const answer = await readline.question("> ");

      try {
        return parseSelection(answer, availability);
      } catch (error) {
        if (error instanceof UserInputError) {
          output.write(`${error.message}\n`);
          continue;
        }

        throw error;
      }
    }
  } finally {
    readline.close();
  }
};
