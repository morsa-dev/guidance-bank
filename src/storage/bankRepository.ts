import path from "node:path";

import { parseProviderIntegrationDescriptor } from "../core/bank/integration.js";
import { createStarterFiles, resolveBankPaths } from "../core/bank/layout.js";
import { parseManifest } from "../core/bank/manifest.js";
import type {
  EntryKind,
  ListedEntry,
  McpServerConfig,
  MemoryBankManifest,
  ProviderId,
  ProviderIntegrationDescriptor,
} from "../core/bank/types.js";
import { ValidationError } from "../shared/errors.js";
import {
  ensureManagedDirectory,
  listManagedFilesRecursively,
  managedPathExists,
  readManagedJsonFile,
  readManagedTextFile,
  writeManagedJsonFile,
  writeManagedTextFileIfMissing,
} from "./safeFs.js";

export class BankRepository {
  readonly paths: ReturnType<typeof resolveBankPaths>;

  constructor(readonly rootPath: string) {
    this.paths = resolveBankPaths(rootPath);
  }

  async ensureStructure(): Promise<void> {
    await ensureManagedDirectory(this.rootPath, this.paths.root);
    await ensureManagedDirectory(this.rootPath, this.paths.rulesDirectory);
    await ensureManagedDirectory(this.rootPath, this.paths.skillsDirectory);
    await ensureManagedDirectory(this.rootPath, this.paths.mcpDirectory);
    await ensureManagedDirectory(this.rootPath, this.paths.integrationsDirectory);
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.rulesDirectory, "core"));
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.rulesDirectory, "stacks"));
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.rulesDirectory, "providers"));
  }

  async ensureStarterFiles(): Promise<void> {
    for (const starterFile of createStarterFiles(this.paths)) {
      await writeManagedTextFileIfMissing(this.rootPath, starterFile.filePath, starterFile.content);
    }
  }

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

  private resolveEntryBasePath(kind: EntryKind): string {
    return kind === "rules" ? this.paths.rulesDirectory : this.paths.skillsDirectory;
  }

  private resolvePathWithinEntryBase(basePath: string, relativePath: string): string {
    const resolvedPath = path.resolve(basePath, relativePath);
    const normalizedRelativePath = path.relative(basePath, resolvedPath);

    if (normalizedRelativePath.startsWith("..") || path.isAbsolute(normalizedRelativePath)) {
      throw new ValidationError(`Entry path escapes ${path.basename(basePath)}: ${relativePath}`);
    }

    return resolvedPath;
  }

  async listEntries(kind: EntryKind, groupPath?: string): Promise<ListedEntry[]> {
    const basePath = this.resolveEntryBasePath(kind);
    const resolvedBasePath = groupPath ? this.resolvePathWithinEntryBase(basePath, groupPath) : basePath;
    const filePaths = await listManagedFilesRecursively(this.rootPath, resolvedBasePath);

    return filePaths.map((filePath) => ({
      path: path.relative(basePath, filePath),
    }));
  }

  async readEntry(kind: EntryKind, entryPath: string): Promise<string> {
    const basePath = this.resolveEntryBasePath(kind);
    const resolvedEntryPath = this.resolvePathWithinEntryBase(basePath, entryPath);

    if (!(await managedPathExists(this.rootPath, resolvedEntryPath))) {
      throw new ValidationError(`Entry not found: ${kind}/${entryPath}`);
    }

    return readManagedTextFile(this.rootPath, resolvedEntryPath);
  }
}
