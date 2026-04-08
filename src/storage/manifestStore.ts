import { parseManifest } from "../core/bank/manifest.js";
import { resolveBankPaths } from "../core/bank/layout.js";
import type { McpServerConfig, MemoryBankManifest } from "../core/bank/types.js";
import { managedPathExists, readManagedJsonFile, writeManagedJsonFile } from "./safeFs.js";

type BankPaths = ReturnType<typeof resolveBankPaths>;

export class ManifestStore {
  constructor(
    private readonly rootPath: string,
    private readonly paths: BankPaths,
  ) {}

  async hasManifest(): Promise<boolean> {
    return managedPathExists(this.rootPath, this.paths.manifestFile);
  }

  async readManifest(): Promise<MemoryBankManifest> {
    const manifest = await readManagedJsonFile<unknown>(this.rootPath, this.paths.manifestFile);
    return parseManifest(manifest);
  }

  async readManifestOptional(): Promise<MemoryBankManifest | null> {
    if (!(await this.hasManifest())) {
      return null;
    }

    return this.readManifest();
  }

  async writeManifest(manifest: MemoryBankManifest): Promise<void> {
    await writeManagedJsonFile(this.rootPath, this.paths.manifestFile, manifest);
  }

  async writeMcpServerConfig(config: McpServerConfig): Promise<void> {
    await writeManagedJsonFile(this.rootPath, this.paths.mcpServerConfigFile, config);
  }
}
