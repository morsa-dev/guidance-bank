import { BankRepository } from "../../storage/bankRepository.js";
import { resolveBankRoot } from "../../shared/paths.js";
import { ValidationError } from "../../shared/errors.js";
import { runCommand } from "../../integrations/commandRunner.js";
import { createDefaultMcpServerConfig } from "../../mcp/config.js";
import { getProviderDefinition } from "../providers/providerRegistry.js";
import type { StopOptions, StopResult } from "./stopTypes.js";

export class StopService {
  async run(options: StopOptions = {}): Promise<StopResult> {
    const bankRoot = resolveBankRoot(options.bankRoot);
    const repository = new BankRepository(bankRoot);
    const manifest = await repository.readManifestOptional();

    if (manifest === null) {
      throw new ValidationError("AI Guidance Bank is not initialized yet. Run `gbank init` first.");
    }

    const mcpServerConfig = createDefaultMcpServerConfig(bankRoot);
    const commandRunner = options.commandRunner ?? runCommand;
    const integrations = await Promise.all(
      manifest.enabledProviders.map(async (provider) => ({
        provider,
        descriptor: await repository.readProviderIntegrationOptional(provider),
      })),
    );

    const stoppedProviders = [];
    for (const { provider, descriptor } of integrations) {
      const result = await getProviderDefinition(provider).uninstall({
        bankRoot,
        commandRunner,
        existingDescriptor: descriptor,
        mcpServerConfig,
        ...(options.cursorConfigRoot ? { cursorConfigRoot: options.cursorConfigRoot } : {}),
      });
      stoppedProviders.push(result);
    }

    return {
      bankRoot,
      stoppedProviders,
      enabledProviders: manifest.enabledProviders,
      integrations,
    };
  }
}
