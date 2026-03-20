import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { PROVIDER_DEFINITIONS } from "../../core/providers/providerRegistry.js";
import type { ProviderId } from "../../core/bank/types.js";
import { UserInputError } from "../../shared/errors.js";

const selectionSeparators = /[\s,]+/;

const parseSelection = (value: string): ProviderId[] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return PROVIDER_DEFINITIONS.map((provider) => provider.id);
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
      selectedProviders.add(providerByIndex.id);
      continue;
    }

    const providerByName = PROVIDER_DEFINITIONS.find((provider) => {
      const normalizedLabel = provider.displayName.toLowerCase().replaceAll(" ", "-");
      return lowerToken === provider.id || lowerToken === normalizedLabel;
    });

    if (providerByName) {
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
    throw new UserInputError("mb init requires an interactive terminal in the current MVP.");
  }

  output.write("Select providers to enable for this Memory Bank:\n");
  for (const [index, provider] of PROVIDER_DEFINITIONS.entries()) {
    output.write(`${index + 1}. ${provider.displayName}\n`);
  }
  output.write("Enter comma-separated numbers or provider ids. Press Enter to select all.\n");

  const readline = createInterface({ input, output });

  try {
    while (true) {
      const answer = await readline.question("> ");

      try {
        return parseSelection(answer);
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
