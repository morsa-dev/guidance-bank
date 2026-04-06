import path from "node:path";
import { promises as fs } from "node:fs";

import { discoverProviderProjectGuidance, type ProviderProjectGuidanceProvider } from "./providerProjectGuidance.js";

export type ExistingGuidanceSourceKind =
  | "agents"
  | "claude-md"
  | "copilot"
  | "cursor"
  | "claude"
  | "codex"
  | "cursor-project"
  | "claude-project"
  | "codex-project";
export type ExistingGuidanceSourceEntryType = "file" | "directory";
export type ExistingGuidanceSourceScope = "repository-local" | "provider-project";

export type ExistingGuidanceSource = {
  kind: ExistingGuidanceSourceKind;
  entryType: ExistingGuidanceSourceEntryType;
  scope: ExistingGuidanceSourceScope;
  provider: ProviderProjectGuidanceProvider | null;
  path: string;
  relativePath: string;
};

const fileCandidates: Array<{ kind: ExistingGuidanceSourceKind; relativePath: string }> = [
  { kind: "agents", relativePath: "AGENTS.md" },
  { kind: "claude-md", relativePath: "CLAUDE.md" },
  { kind: "claude-md", relativePath: "claude.md" },
  { kind: "copilot", relativePath: "copilot-instructions.md" },
  { kind: "copilot", relativePath: ".github/copilot-instructions.md" },
];

const directoryCandidates: Array<{ kind: ExistingGuidanceSourceKind; relativePath: string }> = [
  { kind: "cursor", relativePath: ".cursor" },
  { kind: "claude", relativePath: ".claude" },
  { kind: "codex", relativePath: ".codex" },
];

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const listFilesRecursively = async (directoryPath: string): Promise<string[]> => {
  const directoryEntries = await fs.readdir(directoryPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const directoryEntry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directoryPath, directoryEntry.name);

    if (directoryEntry.isDirectory()) {
      filePaths.push(...(await listFilesRecursively(entryPath)));
      continue;
    }

    if (directoryEntry.isFile()) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
};

export const discoverExistingGuidance = async (projectPath: string): Promise<ExistingGuidanceSource[]> => {
  const resolvedProjectPath = path.resolve(projectPath);
  const discoveredSources: ExistingGuidanceSource[] = [];

  for (const candidate of fileCandidates) {
    const candidatePath = path.join(resolvedProjectPath, candidate.relativePath);

    if (!(await pathExists(candidatePath))) {
      continue;
    }

    discoveredSources.push({
      kind: candidate.kind,
      entryType: "file",
      scope: "repository-local",
      provider: null,
      path: candidatePath,
      relativePath: candidate.relativePath,
    });
  }

  for (const candidate of directoryCandidates) {
    const candidatePath = path.join(resolvedProjectPath, candidate.relativePath);

    if (!(await pathExists(candidatePath))) {
      continue;
    }

    discoveredSources.push({
      kind: candidate.kind,
      entryType: "directory",
      scope: "repository-local",
      provider: null,
      path: candidatePath,
      relativePath: candidate.relativePath,
    });

    const nestedFilePaths = await listFilesRecursively(candidatePath);
    for (const nestedFilePath of nestedFilePaths) {
      discoveredSources.push({
        kind: candidate.kind,
        entryType: "file",
        scope: "repository-local",
        provider: null,
        path: nestedFilePath,
        relativePath: path.relative(resolvedProjectPath, nestedFilePath),
      });
    }
  }

  const providerProjectSources = await discoverProviderProjectGuidance(resolvedProjectPath);
  for (const source of providerProjectSources) {
    const kind: ExistingGuidanceSourceKind =
      source.provider === "codex"
        ? "codex-project"
        : source.provider === "cursor"
          ? "cursor-project"
          : "claude-project";

    discoveredSources.push({
      kind,
      entryType: source.entryType,
      scope: "provider-project",
      provider: source.provider,
      path: source.path,
      relativePath: source.relativePath,
    });
  }

  return discoveredSources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};
