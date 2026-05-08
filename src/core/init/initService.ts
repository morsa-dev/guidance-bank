import path from "node:path";
import { promises as fs } from "node:fs";

import { createManifest, sortProviders, updateManifest } from "../bank/manifest.js";
import type { ProviderId } from "../bank/types.js";
import { getProviderDefinition } from "../providers/providerRegistry.js";
import { BankRepository } from "../../storage/bankRepository.js";
import { BANK_DIRECTORY_NAME, LEGACY_BANK_DIRECTORY_NAMES, resolveBankRoot } from "../../shared/paths.js";
import { createDefaultMcpServerConfig } from "../../mcp/config.js";
import { ensureGuidanceBankLaunchers } from "../../mcp/launcher.js";
import { runCommand } from "../../integrations/commandRunner.js";
import { ValidationError } from "../../shared/errors.js";
import type { InitOptions, InitResult } from "./initTypes.js";

const assertSelectedProviders = (providerIds: readonly ProviderId[]): ProviderId[] => {
  const normalizedProviders = sortProviders(providerIds);
  if (normalizedProviders.length === 0) {
    throw new ValidationError("At least one provider must be selected during init.");
  }

  return normalizedProviders;
};

const resolveLegacyBankRoots = (bankRoot: string): string[] => {
  const resolvedBankRoot = path.resolve(bankRoot);
  if (path.basename(resolvedBankRoot) !== BANK_DIRECTORY_NAME) {
    return [];
  }

  return LEGACY_BANK_DIRECTORY_NAMES.map((directoryName) => path.join(path.dirname(resolvedBankRoot), directoryName));
};

const moveBankRoot = async (sourceRoot: string, targetRoot: string): Promise<void> => {
  if (sourceRoot === targetRoot) {
    return;
  }

  try {
    await fs.access(targetRoot);
    throw new ValidationError(`Cannot migrate AI Guidance Bank into an existing path: ${targetRoot}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(targetRoot), { recursive: true });

  try {
    await fs.rename(sourceRoot, targetRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }

    await fs.cp(sourceRoot, targetRoot, { recursive: true });
    await fs.rm(sourceRoot, { recursive: true, force: true });
  }
};

export class InitService {
  async run(options: InitOptions): Promise<InitResult> {
    const selectedProviders = assertSelectedProviders(options.selectedProviders);
    const bankRoot = resolveBankRoot(options.bankRoot);
    const commandRunner = options.commandRunner ?? runCommand;
    const legacyBankRoots = resolveLegacyBankRoots(bankRoot);
    const repository = new BankRepository(bankRoot);

    const existingManifestBeforeInit = await repository.readManifestOptional();
    if (existingManifestBeforeInit === null && legacyBankRoots.length > 0) {
      const legacyMatches: string[] = [];

      for (const legacyBankRoot of legacyBankRoots) {
        const legacyRepository = new BankRepository(legacyBankRoot);
        const legacyManifest = await legacyRepository.readManifestOptional();
        if (legacyManifest !== null) {
          legacyMatches.push(legacyBankRoot);
        }
      }

      if (legacyMatches.length > 1) {
        throw new ValidationError(
          `Multiple legacy AI Guidance Bank roots were found: ${legacyMatches.join(", ")}. Resolve them manually before running \`gbank init\`.`,
        );
      }

      if (legacyMatches.length === 1) {
        await moveBankRoot(legacyMatches[0]!, bankRoot);
      }
    }

    await repository.ensureStructure();
    await repository.ensureStarterFiles();

    const existingManifest = await repository.readManifestOptional();
    const enabledProviders = sortProviders([
      ...(existingManifest?.enabledProviders ?? []),
      ...selectedProviders,
    ]);

    const manifest = existingManifest
      ? updateManifest(existingManifest, enabledProviders)
      : createManifest(enabledProviders);

    const mcpServerConfig = createDefaultMcpServerConfig(bankRoot);

    await ensureGuidanceBankLaunchers(bankRoot, {
      includeClaudeCodeHook: enabledProviders.includes("claude-code"),
    });
    await repository.writeManifest(manifest);
    await repository.writeMcpServerConfig(mcpServerConfig);

    const integrations = [];
    for (const providerId of enabledProviders) {
      const existingDescriptor = await repository.readProviderIntegrationOptional(providerId);
      const integration = await getProviderDefinition(providerId).install({
        bankRoot,
        commandRunner,
        existingDescriptor,
        mcpServerConfig,
        ...(options.cursorConfigRoot ? { cursorConfigRoot: options.cursorConfigRoot } : {}),
        ...(options.claudeConfigRoot ? { claudeConfigRoot: options.claudeConfigRoot } : {}),
      });
      integrations.push(integration);
    }

    for (const integration of integrations) {
      await repository.writeProviderIntegration(integration.descriptor.provider, integration.descriptor);
    }

    return {
      bankRoot,
      alreadyExisted: existingManifest !== null,
      manifest,
      mcpServerConfig,
      integrations,
    };
  }
}
