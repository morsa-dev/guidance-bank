import path from "node:path";

import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../core/bank/canonicalEntry.js";
import type { ProjectLocalBankPaths } from "../core/bank/projectLocalBank.js";
import type { ListedEntry } from "../core/bank/types.js";
import { ValidationError } from "../shared/errors.js";
import {
  deleteManagedDirectory,
  deleteManagedFile,
  listManagedFilesRecursively,
  managedPathExists,
  readManagedTextFile,
  writeManagedTextFile,
} from "./safeFs.js";

const normalizeListedPath = (entryPath: string): string => entryPath.replaceAll("\\", "/");

const hasHiddenPathSegment = (entryPath: string): boolean =>
  normalizeListedPath(entryPath)
    .split("/")
    .some((segment) => segment.startsWith("."));

const isListableRulePath = (entryPath: string): boolean => {
  if (hasHiddenPathSegment(entryPath)) return false;
  const normalized = normalizeListedPath(entryPath).toLowerCase();
  const basename = path.posix.basename(normalized);
  return normalized.endsWith(".md") && basename !== "readme.md" && basename !== "skill.md";
};

const isListableSkillPath = (entryPath: string): boolean => {
  if (hasHiddenPathSegment(entryPath)) return false;
  return path.posix.basename(normalizeListedPath(entryPath).toLowerCase()) === "skill.md";
};

const validateRuleEntryPath = (entryPath: string): void => {
  const normalized = entryPath.replaceAll("\\", "/").trim();
  if (!normalized.endsWith(".md")) throw new ValidationError("Rule path must end with .md.");
  if (path.posix.basename(normalized).toLowerCase() === "skill.md") {
    throw new ValidationError("Rule path cannot target SKILL.md.");
  }
};

const normalizeSkillFolderPath = (skillPath: string): string => {
  const trimmed = skillPath.replaceAll("\\", "/").trim().replace(/\/+$/u, "");
  const lower = trimmed.toLowerCase();
  if (trimmed.length === 0) throw new ValidationError("Skill path must not be empty.");
  if (lower === "skill.md") throw new ValidationError("Skill path must reference a skill folder, not SKILL.md directly.");
  if (lower.endsWith("/skill.md")) return trimmed.slice(0, -"/SKILL.md".length);
  return trimmed;
};

const resolvePathWithinBase = (basePath: string, relativePath: string): string => {
  const resolved = path.resolve(basePath, relativePath);
  const relative = path.relative(basePath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ValidationError(`Entry path escapes base directory: ${relativePath}`);
  }
  return resolved;
};

export class ProjectLocalEntryStore {
  constructor(private readonly paths: ProjectLocalBankPaths) {}

  private get root(): string {
    return this.paths.root;
  }

  private basePath(kind: "rules" | "skills"): string {
    return kind === "rules" ? this.paths.rulesDirectory : this.paths.skillsDirectory;
  }

  async listEntries(kind: "rules" | "skills", group?: string): Promise<ListedEntry[]> {
    const base = this.basePath(kind);
    const startDir = group !== undefined ? resolvePathWithinBase(base, group) : base;
    const filePaths = await listManagedFilesRecursively(this.root, startDir);
    return filePaths
      .map((filePath) => ({ path: path.relative(base, filePath) }))
      .filter((entry) => (kind === "rules" ? isListableRulePath(entry.path) : isListableSkillPath(entry.path)));
  }

  async readEntry(kind: "rules" | "skills", entryPath: string): Promise<string> {
    const resolved = resolvePathWithinBase(this.basePath(kind), entryPath);
    return readManagedTextFile(this.root, resolved);
  }

  async readEntryOptional(kind: "rules" | "skills", entryPath: string): Promise<string | null> {
    const resolved = resolvePathWithinBase(this.basePath(kind), entryPath);
    if (!(await managedPathExists(this.root, resolved))) return null;
    return readManagedTextFile(this.root, resolved);
  }

  async upsertRule(
    entryPath: string,
    content: string,
  ): Promise<{ status: "created" | "updated"; path: string; absolutePath: string }> {
    validateRuleEntryPath(entryPath);
    parseCanonicalRuleDocument(content);
    const base = this.basePath("rules");
    const resolved = resolvePathWithinBase(base, entryPath);
    const existed = await managedPathExists(this.root, resolved);
    await writeManagedTextFile(this.root, resolved, content);
    return {
      status: existed ? "updated" : "created",
      path: path.relative(base, resolved),
      absolutePath: resolved,
    };
  }

  async upsertSkill(
    skillPath: string,
    content: string,
  ): Promise<{ status: "created" | "updated"; path: string; filePath: string; absolutePath: string }> {
    const normalized = normalizeSkillFolderPath(skillPath);
    parseCanonicalSkillDocument(content);
    const base = this.basePath("skills");
    const skillDir = resolvePathWithinBase(base, normalized);
    const resolved = path.join(skillDir, "SKILL.md");
    const existed = await managedPathExists(this.root, resolved);
    await writeManagedTextFile(this.root, resolved, content);
    return {
      status: existed ? "updated" : "created",
      path: path.relative(base, skillDir),
      filePath: path.relative(base, resolved),
      absolutePath: resolved,
    };
  }

  async deleteRule(entryPath: string): Promise<{ status: "deleted" | "not_found"; path: string }> {
    validateRuleEntryPath(entryPath);
    const base = this.basePath("rules");
    const resolved = resolvePathWithinBase(base, entryPath);
    const deleted = await deleteManagedFile(this.root, resolved);
    return { status: deleted ? "deleted" : "not_found", path: path.relative(base, resolved) };
  }

  async deleteSkill(skillPath: string): Promise<{ status: "deleted" | "not_found"; path: string }> {
    const normalized = normalizeSkillFolderPath(skillPath);
    const base = this.basePath("skills");
    const skillDir = resolvePathWithinBase(base, normalized);
    const deleted = await deleteManagedDirectory(this.root, skillDir);
    return { status: deleted ? "deleted" : "not_found", path: path.relative(base, skillDir) };
  }
}
