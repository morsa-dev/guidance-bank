import path from "node:path";
import { promises as fs } from "node:fs";

import { discoverProviderProjectGuidance, type ProviderProjectGuidanceProvider } from "./providerProjectGuidance.js";
import { discoverProviderGlobalGuidance } from "./providerGlobalGuidance.js";
import { fingerprintGuidancePath, listFilesRecursively, pathExists } from "./guidanceFingerprint.js";

export type ExistingGuidanceSourceEntryType = "file" | "directory";
export type ExistingGuidanceSourceScope = "repository-local" | "provider-project" | "provider-global";

export type ExistingGuidanceSource = {
  entryType: ExistingGuidanceSourceEntryType;
  scope: ExistingGuidanceSourceScope;
  provider: ProviderProjectGuidanceProvider | null;
  path: string;
  relativePath: string;
  fingerprint: string;
};

const fileCandidates: Array<{ relativePath: string; provider: ProviderProjectGuidanceProvider | null }> = [
  { relativePath: "AGENTS.md", provider: null },
  { relativePath: ".cursorrules", provider: "cursor" },
  { relativePath: "CLAUDE.md", provider: "claude" },
  { relativePath: "claude.md", provider: "claude" },
  { relativePath: "copilot-instructions.md", provider: null },
  { relativePath: ".github/copilot-instructions.md", provider: null },
];

const directoryCandidates: Array<{ relativePath: string; provider: ProviderProjectGuidanceProvider | null }> = [
  { relativePath: ".cursor", provider: "cursor" },
  { relativePath: ".claude", provider: "claude" },
  { relativePath: ".codex", provider: "codex" },
];

export const discoverExistingGuidance = async (projectPath: string): Promise<ExistingGuidanceSource[]> => {
  const resolvedProjectPath = path.resolve(projectPath);
  const discoveredSources: ExistingGuidanceSource[] = [];
  const discoveredFileRealPaths = new Set<string>();

  for (const candidate of fileCandidates) {
    const candidatePath = path.join(resolvedProjectPath, candidate.relativePath);

    if (!(await pathExists(candidatePath))) {
      continue;
    }

    const resolvedCandidatePath = await fs.realpath(candidatePath);
    if (discoveredFileRealPaths.has(resolvedCandidatePath)) {
      continue;
    }
    discoveredFileRealPaths.add(resolvedCandidatePath);

    discoveredSources.push({
      entryType: "file",
      scope: "provider-project",
      provider: candidate.provider,
      path: resolvedCandidatePath,
      relativePath: candidate.relativePath,
      fingerprint: await fingerprintGuidancePath(resolvedCandidatePath, "file"),
    });
  }

  for (const candidate of directoryCandidates) {
    const candidatePath = path.join(resolvedProjectPath, candidate.relativePath);

    if (!(await pathExists(candidatePath))) {
      continue;
    }

    discoveredSources.push({
      entryType: "directory",
      scope: "provider-project",
      provider: candidate.provider,
      path: candidatePath,
      relativePath: candidate.relativePath,
      fingerprint: await fingerprintGuidancePath(candidatePath, "directory"),
    });

    const nestedFilePaths = await listFilesRecursively(candidatePath);
    for (const nestedFilePath of nestedFilePaths) {
      discoveredSources.push({
        entryType: "file",
        scope: "provider-project",
        provider: candidate.provider,
        path: nestedFilePath,
        relativePath: path.relative(resolvedProjectPath, nestedFilePath),
        fingerprint: await fingerprintGuidancePath(nestedFilePath, "file"),
      });
    }
  }

  const providerProjectSources = await discoverProviderProjectGuidance(resolvedProjectPath);
  for (const source of providerProjectSources) {
    discoveredSources.push({
      entryType: source.entryType,
      scope: "provider-project",
      provider: source.provider,
      path: source.path,
      relativePath: source.relativePath,
      fingerprint: source.fingerprint,
    });
  }

  const providerGlobalSources = await discoverProviderGlobalGuidance();
  for (const source of providerGlobalSources) {
    discoveredSources.push({
      entryType: source.entryType,
      scope: "provider-global",
      provider: source.provider,
      path: source.path,
      relativePath: source.relativePath,
      fingerprint: source.fingerprint,
    });
  }

  return discoveredSources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};
