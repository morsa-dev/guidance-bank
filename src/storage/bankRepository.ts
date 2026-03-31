import path from "node:path";

import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../core/bank/canonicalEntry.js";
import { parseProviderIntegrationDescriptor } from "../core/bank/integration.js";
import { createStarterFiles, resolveBankPaths } from "../core/bank/layout.js";
import { parseManifest } from "../core/bank/manifest.js";
import { parseProjectBankManifest, parseProjectBankState } from "../core/bank/project.js";
import type {
  EntryKind,
  EntryScope,
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
  deleteManagedDirectory,
  deleteManagedFile,
  ensureManagedDirectory,
  listManagedChildDirectories,
  listManagedFilesRecursively,
  managedPathExists,
  readManagedJsonFile,
  readManagedTextFile,
  writeManagedTextFile,
  writeManagedJsonFile,
  writeManagedTextFileIfMissing,
} from "./safeFs.js";

export class BankRepository {
  readonly paths: ReturnType<typeof resolveBankPaths>;

  constructor(readonly rootPath: string) {
    this.paths = resolveBankPaths(rootPath);
  }

  // TODO: Multi-agent concurrency is still last-write-wins at the entry level.
  // Separate `mb mcp serve` processes can update the same rule or skill concurrently.
  // Atomic writes protect file integrity, but they do not detect semantic conflicts.
  // Add revision stamps or optimistic locking before relying on shared concurrent edits.

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

  async listProjectManifests(): Promise<ProjectBankManifest[]> {
    const projectDirectoryPaths = await listManagedChildDirectories(this.rootPath, this.paths.projectsDirectory);
    const manifests = await Promise.all(
      projectDirectoryPaths.map(async (projectDirectoryPath) => {
        const projectId = path.basename(projectDirectoryPath);
        return this.readProjectManifestOptional(projectId);
      }),
    );

    return manifests.filter((manifest): manifest is ProjectBankManifest => manifest !== null);
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

  async deleteProjectBank(projectId: string): Promise<boolean> {
    const deleted = await deleteManagedDirectory(this.rootPath, this.paths.projectDirectory(projectId));

    if (deleted) {
      await this.touchManifest();
    }

    return deleted;
  }

  private resolveEntryBasePath(kind: EntryKind, layer: EntryScope, projectId?: string): string {
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
    layer: EntryScope,
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

  async readLayerEntry(layer: EntryScope, kind: EntryKind, entryPath: string, projectId?: string): Promise<string> {
    const basePath = this.resolveEntryBasePath(kind, layer, projectId);
    const resolvedEntryPath = this.resolvePathWithinEntryBase(basePath, entryPath);

    if (!(await managedPathExists(this.rootPath, resolvedEntryPath))) {
      throw new ValidationError(`Entry not found: ${kind}/${entryPath}`);
    }

    return readManagedTextFile(this.rootPath, resolvedEntryPath);
  }

  async readLayerEntryOptional(
    layer: EntryScope,
    kind: EntryKind,
    entryPath: string,
    projectId?: string,
  ): Promise<string | null> {
    const basePath = this.resolveEntryBasePath(kind, layer, projectId);
    const resolvedEntryPath = this.resolvePathWithinEntryBase(basePath, entryPath);

    if (!(await managedPathExists(this.rootPath, resolvedEntryPath))) {
      return null;
    }

    return readManagedTextFile(this.rootPath, resolvedEntryPath);
  }

  private async touchManifest(): Promise<void> {
    const manifest = await this.readManifestOptional();
    if (manifest === null) {
      return;
    }

    await this.writeManifest({
      ...manifest,
      updatedAt: new Date().toISOString(),
    });
  }

  private async touchProjectManifest(projectId: string): Promise<void> {
    const manifest = await this.readProjectManifestOptional(projectId);
    if (manifest === null) {
      return;
    }

    await this.writeProjectManifest(projectId, {
      ...manifest,
      updatedAt: new Date().toISOString(),
    });
  }

  private validateRuleEntryPath(entryPath: string): void {
    const normalizedPath = entryPath.replaceAll("\\", "/").trim();

    if (!normalizedPath.endsWith(".md")) {
      throw new ValidationError("Rule path must end with .md.");
    }

    if (path.posix.basename(normalizedPath).toLowerCase() === "skill.md") {
      throw new ValidationError("Rule path cannot target SKILL.md.");
    }
  }

  private normalizeSkillPath(skillPath: string): string {
    const trimmedPath = skillPath.replaceAll("\\", "/").trim().replace(/\/+$/u, "");
    const lowerCasePath = trimmedPath.toLowerCase();

    if (trimmedPath.length === 0) {
      throw new ValidationError("Skill path must not be empty.");
    }

    if (lowerCasePath === "skill.md") {
      throw new ValidationError("Skill path must reference a skill folder, not SKILL.md directly.");
    }

    if (lowerCasePath.endsWith("/skill.md")) {
      return trimmedPath.slice(0, -"/SKILL.md".length);
    }

    return trimmedPath;
  }

  async upsertRule(
    layer: EntryScope,
    entryPath: string,
    content: string,
    projectId?: string,
  ): Promise<{ status: "created" | "updated"; path: string; absolutePath: string }> {
    this.validateRuleEntryPath(entryPath);
    parseCanonicalRuleDocument(content);
    const basePath = this.resolveEntryBasePath("rules", layer, projectId);
    const resolvedEntryPath = this.resolvePathWithinEntryBase(basePath, entryPath);
    const existed = await managedPathExists(this.rootPath, resolvedEntryPath);

    await writeManagedTextFile(this.rootPath, resolvedEntryPath, content);
    await this.touchManifest();
    if (layer === "project" && projectId) {
      await this.touchProjectManifest(projectId);
    }

    return {
      status: existed ? "updated" : "created",
      path: path.relative(basePath, resolvedEntryPath),
      absolutePath: resolvedEntryPath,
    };
  }

  async upsertSkill(
    layer: EntryScope,
    skillPath: string,
    content: string,
    projectId?: string,
  ): Promise<{ status: "created" | "updated"; path: string; filePath: string; absolutePath: string }> {
    const normalizedSkillPath = this.normalizeSkillPath(skillPath);
    parseCanonicalSkillDocument(content);
    const basePath = this.resolveEntryBasePath("skills", layer, projectId);
    const resolvedSkillDirectory = this.resolvePathWithinEntryBase(basePath, normalizedSkillPath);
    const resolvedEntryPath = path.join(resolvedSkillDirectory, "SKILL.md");
    const existed = await managedPathExists(this.rootPath, resolvedEntryPath);

    await writeManagedTextFile(this.rootPath, resolvedEntryPath, content);
    await this.touchManifest();
    if (layer === "project" && projectId) {
      await this.touchProjectManifest(projectId);
    }

    return {
      status: existed ? "updated" : "created",
      path: path.relative(basePath, resolvedSkillDirectory),
      filePath: path.relative(basePath, resolvedEntryPath),
      absolutePath: resolvedEntryPath,
    };
  }

  async deleteRule(
    layer: EntryScope,
    entryPath: string,
    projectId?: string,
  ): Promise<{ status: "deleted" | "not_found"; path: string }> {
    this.validateRuleEntryPath(entryPath);
    const basePath = this.resolveEntryBasePath("rules", layer, projectId);
    const resolvedEntryPath = this.resolvePathWithinEntryBase(basePath, entryPath);
    const deleted = await deleteManagedFile(this.rootPath, resolvedEntryPath);

    if (deleted) {
      await this.touchManifest();
      if (layer === "project" && projectId) {
        await this.touchProjectManifest(projectId);
      }
    }

    return {
      status: deleted ? "deleted" : "not_found",
      path: path.relative(basePath, resolvedEntryPath),
    };
  }

  async deleteSkill(
    layer: EntryScope,
    skillPath: string,
    projectId?: string,
  ): Promise<{ status: "deleted" | "not_found"; path: string }> {
    const normalizedSkillPath = this.normalizeSkillPath(skillPath);
    const basePath = this.resolveEntryBasePath("skills", layer, projectId);
    const resolvedSkillDirectory = this.resolvePathWithinEntryBase(basePath, normalizedSkillPath);
    const deleted = await deleteManagedDirectory(this.rootPath, resolvedSkillDirectory);

    if (deleted) {
      await this.touchManifest();
      if (layer === "project" && projectId) {
        await this.touchProjectManifest(projectId);
      }
    }

    return {
      status: deleted ? "deleted" : "not_found",
      path: path.relative(basePath, resolvedSkillDirectory),
    };
  }
}
