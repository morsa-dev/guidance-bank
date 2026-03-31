import { createManifest, sortProviders, updateManifest } from "../bank/manifest.js";
import type { ProviderId } from "../bank/types.js";
import { getProviderDefinition } from "../providers/providerRegistry.js";
import { BankRepository } from "../../storage/bankRepository.js";
import { resolveBankRoot } from "../../shared/paths.js";
import { createDefaultMcpServerConfig } from "../../mcp/config.js";
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

export class InitService {
  async run(options: InitOptions): Promise<InitResult> {
    const selectedProviders = assertSelectedProviders(options.selectedProviders);
    const bankRoot = resolveBankRoot(options.bankRoot);
    const commandRunner = options.commandRunner ?? runCommand;
    const repository = new BankRepository(bankRoot);

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
