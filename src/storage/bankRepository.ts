import path from "node:path";

import { parseProviderIntegrationDescriptor } from "../core/bank/integration.js";
import { createStarterFiles, resolveBankPaths } from "../core/bank/layout.js";
import { parseManifest } from "../core/bank/manifest.js";
import { parseProjectBankManifest, parseProjectBankState } from "../core/bank/project.js";
import type {
  EntryKind,
  ListedEntry,
  McpServerConfig,
  MemoryBankManifest,
  ProjectBankManifest,
  ProjectBankState,
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

type BankLayer = "shared" | "project";

export class BankRepository {
  readonly paths: ReturnType<typeof resolveBankPaths>;

  constructor(readonly rootPath: string) {
    this.paths = resolveBankPaths(rootPath);
  }

  async ensureStructure(): Promise<void> {
    await ensureManagedDirectory(this.rootPath, this.paths.root);
    await ensureManagedDirectory(this.rootPath, this.paths.sharedDirectory);
    await ensureManagedDirectory(this.rootPath, this.paths.sharedRulesDirectory);
    await ensureManagedDirectory(this.rootPath, this.paths.sharedSkillsDirectory);
    await ensureManagedDirectory(this.rootPath, this.paths.projectsDirectory);
    await ensureManagedDirectory(this.rootPath, this.paths.mcpDirectory);
    await ensureManagedDirectory(this.rootPath, this.paths.integrationsDirectory);
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.sharedRulesDirectory, "core"));
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.sharedRulesDirectory, "stacks"));
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.sharedRulesDirectory, "providers"));
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.sharedRulesDirectory, "topics"));
  }

  async ensureStarterFiles(): Promise<void> {
    for (const starterFile of createStarterFiles(this.paths)) {
      await writeManagedTextFileIfMissing(this.rootPath, starterFile.filePath, starterFile.content);
    }
  }

  async ensureProjectStructure(projectId: string): Promise<void> {
    await ensureManagedDirectory(this.rootPath, this.paths.projectDirectory(projectId));
    await ensureManagedDirectory(this.rootPath, this.paths.projectRulesDirectory(projectId));
    await ensureManagedDirectory(this.rootPath, this.paths.projectSkillsDirectory(projectId));
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.projectRulesDirectory(projectId), "core"));
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.projectRulesDirectory(projectId), "stacks"));
    await ensureManagedDirectory(this.rootPath, path.join(this.paths.projectRulesDirectory(projectId), "topics"));
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

  async writeProjectManifest(projectId: string, manifest: ProjectBankManifest): Promise<void> {
    await this.ensureProjectStructure(projectId);
    await writeManagedJsonFile(this.rootPath, this.paths.projectManifestFile(projectId), manifest);
  }

  async readProjectManifestOptional(projectId: string): Promise<ProjectBankManifest | null> {
    const manifestFilePath = this.paths.projectManifestFile(projectId);
    if (!(await managedPathExists(this.rootPath, manifestFilePath))) {
      return null;
    }

    const manifest = await readManagedJsonFile<unknown>(this.rootPath, manifestFilePath);
    return parseProjectBankManifest(manifest);
  }

  async writeProjectState(projectId: string, state: ProjectBankState): Promise<void> {
    await this.ensureProjectStructure(projectId);
    await writeManagedJsonFile(this.rootPath, this.paths.projectStateFile(projectId), state);
  }

  async readProjectStateOptional(projectId: string): Promise<ProjectBankState | null> {
    const stateFilePath = this.paths.projectStateFile(projectId);
    if (!(await managedPathExists(this.rootPath, stateFilePath))) {
      return null;
    }

    const state = await readManagedJsonFile<unknown>(this.rootPath, stateFilePath);
    return parseProjectBankState(state);
  }

  private resolveEntryBasePath(kind: EntryKind, layer: BankLayer, projectId?: string): string {
    if (layer === "shared") {
      return kind === "rules" ? this.paths.sharedRulesDirectory : this.paths.sharedSkillsDirectory;
    }

    if (!projectId) {
      throw new ValidationError("Project id is required for project-layer entries.");
    }

    return kind === "rules" ? this.paths.projectRulesDirectory(projectId) : this.paths.projectSkillsDirectory(projectId);
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
    return this.listLayerEntries("shared", kind, undefined, groupPath);
  }

  async listLayerEntries(
    layer: BankLayer,
    kind: EntryKind,
    projectId?: string,
    groupPath?: string,
  ): Promise<ListedEntry[]> {
    const basePath = this.resolveEntryBasePath(kind, layer, projectId);
    const resolvedBasePath = groupPath ? this.resolvePathWithinEntryBase(basePath, groupPath) : basePath;
    const filePaths = await listManagedFilesRecursively(this.rootPath, resolvedBasePath);

    return filePaths.map((filePath) => ({
      path: path.relative(basePath, filePath),
    }));
  }

  async readEntry(kind: EntryKind, entryPath: string): Promise<string> {
    return this.readLayerEntry("shared", kind, entryPath);
  }

  async readLayerEntry(layer: BankLayer, kind: EntryKind, entryPath: string, projectId?: string): Promise<string> {
    const basePath = this.resolveEntryBasePath(kind, layer, projectId);
    const resolvedEntryPath = this.resolvePathWithinEntryBase(basePath, entryPath);

    if (!(await managedPathExists(this.rootPath, resolvedEntryPath))) {
      throw new ValidationError(`Entry not found: ${kind}/${entryPath}`);
    }

    return readManagedTextFile(this.rootPath, resolvedEntryPath);
  }
}
