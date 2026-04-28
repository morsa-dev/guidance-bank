import { createStarterFiles, resolveBankPaths } from "../core/bank/layout.js";
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
import {
  ensureManagedDirectory,
  writeManagedTextFileIfMissing,
} from "./safeFs.js";
import { EntryStore } from "./entryStore.js";
import { ManifestStore } from "./manifestStore.js";
import { ProjectBankStore } from "./projectBankStore.js";
import { ProviderIntegrationStore } from "./providerIntegrationStore.js";
import { AuditStore } from "./auditStore.js";
import type { AuditEvent } from "../core/audit/types.js";
import { ExternalGuidanceDecisionStore } from "./externalGuidanceDecisionStore.js";
import type { ExternalGuidanceDecisionState } from "../core/bank/externalGuidanceDecisions.js";

export class BankRepository {
  readonly paths: ReturnType<typeof resolveBankPaths>;
  private readonly manifestStore: ManifestStore;
  private readonly projectBanks: ProjectBankStore;
  private readonly entries: EntryStore;
  private readonly providerIntegrations: ProviderIntegrationStore;
  private readonly auditStore: AuditStore;
  private readonly externalGuidanceDecisions: ExternalGuidanceDecisionStore;

  constructor(readonly rootPath: string) {
    this.paths = resolveBankPaths(rootPath);
    this.manifestStore = new ManifestStore(rootPath, this.paths);
    this.projectBanks = new ProjectBankStore(rootPath, this.paths);
    this.entries = new EntryStore(rootPath, this.paths);
    this.providerIntegrations = new ProviderIntegrationStore(rootPath, this.paths);
    this.auditStore = new AuditStore(rootPath, this.paths);
    this.externalGuidanceDecisions = new ExternalGuidanceDecisionStore(rootPath, this.paths);
  }

  // TODO: Multi-agent concurrency is still last-write-wins at the entry level.
  // Separate `gbank mcp serve` processes can update the same rule or skill concurrently.
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
    await ensureManagedDirectory(this.rootPath, this.paths.historyDirectory);
  }

  async ensureStarterFiles(): Promise<void> {
    for (const starterFile of createStarterFiles(this.paths)) {
      await writeManagedTextFileIfMissing(this.rootPath, starterFile.filePath, starterFile.content);
    }
  }

  async ensureProjectStructure(projectId: string): Promise<void> {
    await this.projectBanks.ensureProjectStructure(projectId);
  }

  async hasManifest(): Promise<boolean> {
    return this.manifestStore.hasManifest();
  }

  async readManifest(): Promise<MemoryBankManifest> {
    return this.manifestStore.readManifest();
  }

  async readManifestOptional(): Promise<MemoryBankManifest | null> {
    return this.manifestStore.readManifestOptional();
  }

  async writeManifest(manifest: MemoryBankManifest): Promise<void> {
    await this.manifestStore.writeManifest(manifest);
  }

  async writeMcpServerConfig(config: McpServerConfig): Promise<void> {
    await this.manifestStore.writeMcpServerConfig(config);
  }

  async writeProviderIntegration(
    providerId: ProviderId,
    descriptor: ProviderIntegrationDescriptor,
  ): Promise<void> {
    await this.providerIntegrations.writeProviderIntegration(providerId, descriptor);
  }

  async readProviderIntegrationOptional(providerId: ProviderId): Promise<ProviderIntegrationDescriptor | null> {
    return this.providerIntegrations.readProviderIntegrationOptional(providerId);
  }

  async writeProjectManifest(projectId: string, manifest: ProjectBankManifest): Promise<void> {
    await this.projectBanks.writeProjectManifest(projectId, manifest);
  }

  async readProjectManifestOptional(projectId: string): Promise<ProjectBankManifest | null> {
    return this.projectBanks.readProjectManifestOptional(projectId);
  }

  async listProjectManifests(): Promise<ProjectBankManifest[]> {
    return this.projectBanks.listProjectManifests();
  }

  async writeProjectState(projectId: string, state: ProjectBankState): Promise<void> {
    await this.projectBanks.writeProjectState(projectId, state);
  }

  async readProjectStateOptional(projectId: string): Promise<ProjectBankState | null> {
    return this.projectBanks.readProjectStateOptional(projectId);
  }

  async deleteProjectBank(projectId: string): Promise<boolean> {
    const deleted = await this.projectBanks.deleteProjectBank(projectId);

    if (deleted) {
      await this.touchManifest();
    }

    return deleted;
  }

  async readAuditEventsOptional(): Promise<AuditEvent[]> {
    return this.auditStore.readEventsOptional();
  }

  async readExternalGuidanceDecisionState(): Promise<ExternalGuidanceDecisionState> {
    return this.externalGuidanceDecisions.readState();
  }

  async writeExternalGuidanceDecisionState(state: ExternalGuidanceDecisionState): Promise<void> {
    await this.externalGuidanceDecisions.writeState(state);
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
    return this.entries.listLayerEntries(layer, kind, projectId, groupPath);
  }

  async readEntry(kind: EntryKind, entryPath: string): Promise<string> {
    return this.readLayerEntry("shared", kind, entryPath);
  }

  async readLayerEntry(layer: EntryScope, kind: EntryKind, entryPath: string, projectId?: string): Promise<string> {
    return this.entries.readLayerEntry(layer, kind, entryPath, projectId);
  }

  async readLayerEntryOptional(
    layer: EntryScope,
    kind: EntryKind,
    entryPath: string,
    projectId?: string,
  ): Promise<string | null> {
    return this.entries.readLayerEntryOptional(layer, kind, entryPath, projectId);
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

  async touchProjectManifest(projectId: string): Promise<void> {
    const manifest = await this.readProjectManifestOptional(projectId);
    if (manifest === null) {
      return;
    }

    await this.writeProjectManifest(projectId, {
      ...manifest,
      updatedAt: new Date().toISOString(),
    });
  }

  async upsertRule(
    layer: EntryScope,
    entryPath: string,
    content: string,
    projectId?: string,
  ): Promise<{ status: "created" | "updated"; path: string; absolutePath: string }> {
    const result = await this.entries.upsertRule(layer, entryPath, content, projectId);
    await this.touchManifest();
    if (layer === "project" && projectId) {
      await this.touchProjectManifest(projectId);
    }

    return result;
  }

  async upsertSkill(
    layer: EntryScope,
    skillPath: string,
    content: string,
    projectId?: string,
  ): Promise<{ status: "created" | "updated"; path: string; filePath: string; absolutePath: string }> {
    const result = await this.entries.upsertSkill(layer, skillPath, content, projectId);
    await this.touchManifest();
    if (layer === "project" && projectId) {
      await this.touchProjectManifest(projectId);
    }

    return result;
  }

  async deleteRule(
    layer: EntryScope,
    entryPath: string,
    projectId?: string,
  ): Promise<{ status: "deleted" | "not_found"; path: string }> {
    const result = await this.entries.deleteRule(layer, entryPath, projectId);

    if (result.status === "deleted") {
      await this.touchManifest();
      if (layer === "project" && projectId) {
        await this.touchProjectManifest(projectId);
      }
    }

    return result;
  }

  async deleteSkill(
    layer: EntryScope,
    skillPath: string,
    projectId?: string,
  ): Promise<{ status: "deleted" | "not_found"; path: string }> {
    const result = await this.entries.deleteSkill(layer, skillPath, projectId);

    if (result.status === "deleted") {
      await this.touchManifest();
      if (layer === "project" && projectId) {
        await this.touchProjectManifest(projectId);
      }
    }

    return result;
  }
}
