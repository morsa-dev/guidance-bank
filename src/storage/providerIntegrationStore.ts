import { parseProviderIntegrationDescriptor } from "../core/bank/integration.js";
import { resolveBankPaths } from "../core/bank/layout.js";
import type { ProviderId, ProviderIntegrationDescriptor } from "../core/bank/types.js";
import { managedPathExists, readManagedJsonFile, writeManagedJsonFile } from "./safeFs.js";

type BankPaths = ReturnType<typeof resolveBankPaths>;

export class ProviderIntegrationStore {
  constructor(
    private readonly rootPath: string,
    private readonly paths: BankPaths,
  ) {}

  async writeProviderIntegration(
    providerId: ProviderId,
    descriptor: ProviderIntegrationDescriptor,
  ): Promise<void> {
    await writeManagedJsonFile(this.rootPath, this.paths.integrationFile(providerId), descriptor);
  }

  async readProviderIntegrationOptional(providerId: ProviderId): Promise<ProviderIntegrationDescriptor | null> {
    const integrationFilePath = this.paths.integrationFile(providerId);
    if (!(await managedPathExists(this.rootPath, integrationFilePath))) {
      return null;
    }

    const descriptor = await readManagedJsonFile<unknown>(this.rootPath, integrationFilePath);
    return parseProviderIntegrationDescriptor(descriptor);
  }
}
