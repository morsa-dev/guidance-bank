import path from "node:path";

import { discoverProviderProjectGuidance, type ProviderProjectGuidanceProvider } from "./providerProjectGuidance.js";
import { discoverProviderGlobalGuidance } from "./providerGlobalGuidance.js";
import { fingerprintGuidancePath, listFilesRecursively, pathExists } from "./guidanceFingerprint.js";

export type ExistingGuidanceSourceKind =
  | "agents"
  | "claude-md"
  | "copilot"
  | "cursor"
  | "claude"
  | "codex"
  | "codex-project"
  | "claude-global"
  | "codex-global";
export type ExistingGuidanceSourceEntryType = "file" | "directory";
export type ExistingGuidanceSourceScope = "repository-local" | "provider-project" | "provider-global";

export type ExistingGuidanceSource = {
  kind: ExistingGuidanceSourceKind;
  entryType: ExistingGuidanceSourceEntryType;
  scope: ExistingGuidanceSourceScope;
  provider: ProviderProjectGuidanceProvider | null;
  path: string;
  relativePath: string;
  fingerprint: string;
};

const fileCandidates: Array<{ kind: ExistingGuidanceSourceKind; relativePath: string }> = [
  { kind: "agents", relativePath: "AGENTS.md" },
  { kind: "cursor", relativePath: ".cursorrules" },
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
      fingerprint: await fingerprintGuidancePath(candidatePath, "file"),
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
      fingerprint: await fingerprintGuidancePath(candidatePath, "directory"),
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
        fingerprint: await fingerprintGuidancePath(nestedFilePath, "file"),
      });
    }
  }

  const providerProjectSources = await discoverProviderProjectGuidance(resolvedProjectPath);
  for (const source of providerProjectSources) {
    const kind: ExistingGuidanceSourceKind = "codex-project";

    discoveredSources.push({
      kind,
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
    const kind: ExistingGuidanceSourceKind = source.provider === "codex" ? "codex-global" : "claude-global";

    discoveredSources.push({
      kind,
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
