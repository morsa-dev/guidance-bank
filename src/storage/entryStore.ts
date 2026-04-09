import path from "node:path";

import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../core/bank/canonicalEntry.js";
import { resolveBankPaths } from "../core/bank/layout.js";
import type { EntryKind, EntryScope, ListedEntry } from "../core/bank/types.js";
import { ValidationError } from "../shared/errors.js";
import {
  deleteManagedDirectory,
  deleteManagedFile,
  listManagedFilesRecursively,
  managedPathExists,
  readManagedTextFile,
  writeManagedTextFile,
} from "./safeFs.js";

type BankPaths = ReturnType<typeof resolveBankPaths>;

export class EntryStore {
  constructor(
    private readonly rootPath: string,
    private readonly paths: BankPaths,
  ) {}

  resolveEntryBasePath(kind: EntryKind, layer: EntryScope, projectId?: string): string {
    if (layer === "shared") {
      return kind === "rules" ? this.paths.sharedRulesDirectory : this.paths.sharedSkillsDirectory;
    }

    if (!projectId) {
      throw new ValidationError("Project id is required for project-layer entries.");
    }

    return kind === "rules" ? this.paths.projectRulesDirectory(projectId) : this.paths.projectSkillsDirectory(projectId);
  }

  resolvePathWithinEntryBase(basePath: string, relativePath: string): string {
    const resolvedPath = path.resolve(basePath, relativePath);
    const normalizedRelativePath = path.relative(basePath, resolvedPath);

    if (normalizedRelativePath.startsWith("..") || path.isAbsolute(normalizedRelativePath)) {
      throw new ValidationError(`Entry path escapes ${path.basename(basePath)}: ${relativePath}`);
    }

    return resolvedPath;
  }

  private buildReadableEntryCandidates(kind: EntryKind, layer: EntryScope, entryPath: string): string[] {
    const normalizedPath = entryPath.replaceAll("\\", "/").trim();
    if (kind !== "skills") {
      return [normalizedPath];
    }

    const scopePrefix = `${layer}/`;
    const alternatePath = normalizedPath.startsWith(scopePrefix)
      ? normalizedPath.slice(scopePrefix.length)
      : `${scopePrefix}${normalizedPath}`;

    return [...new Set([normalizedPath, alternatePath])];
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

  async readLayerEntry(layer: EntryScope, kind: EntryKind, entryPath: string, projectId?: string): Promise<string> {
    const basePath = this.resolveEntryBasePath(kind, layer, projectId);
    const candidatePaths = this.buildReadableEntryCandidates(kind, layer, entryPath);

    for (const candidatePath of candidatePaths) {
      const resolvedEntryPath = this.resolvePathWithinEntryBase(basePath, candidatePath);
      if (await managedPathExists(this.rootPath, resolvedEntryPath)) {
        return readManagedTextFile(this.rootPath, resolvedEntryPath);
      }
    }

    throw new ValidationError(`Entry not found: ${kind}/${entryPath}`);
  }

  async readLayerEntryOptional(
    layer: EntryScope,
    kind: EntryKind,
    entryPath: string,
    projectId?: string,
  ): Promise<string | null> {
    const basePath = this.resolveEntryBasePath(kind, layer, projectId);
    const candidatePaths = this.buildReadableEntryCandidates(kind, layer, entryPath);

    for (const candidatePath of candidatePaths) {
      const resolvedEntryPath = this.resolvePathWithinEntryBase(basePath, candidatePath);
      if (await managedPathExists(this.rootPath, resolvedEntryPath)) {
        return readManagedTextFile(this.rootPath, resolvedEntryPath);
      }
    }

    return null;
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

    return {
      status: deleted ? "deleted" : "not_found",
      path: path.relative(basePath, resolvedSkillDirectory),
    };
  }
}
