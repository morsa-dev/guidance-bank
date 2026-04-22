import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { fingerprintGuidancePath, listFilesRecursively, pathExists } from "./guidanceFingerprint.js";
import type { ProviderProjectGuidanceProvider } from "./providerProjectGuidance.js";

export type ProviderGlobalGuidanceProvider = ProviderProjectGuidanceProvider;
export type ProviderGlobalGuidanceEntryType = "file" | "directory";

export type ProviderGlobalGuidanceSource = {
  provider: ProviderGlobalGuidanceProvider;
  entryType: ProviderGlobalGuidanceEntryType;
  path: string;
  relativePath: string;
  fingerprint: string;
};

const getHomePath = (): string => process.env.HOME ?? os.homedir();

const toHomeRelativePath = (targetPath: string): string => {
  const homePath = getHomePath();
  const relativeToHome = path.relative(homePath, targetPath);

  return relativeToHome.startsWith("..") || path.isAbsolute(relativeToHome) ? targetPath : `~/${relativeToHome}`;
};

const SKIPPED_CODEX_SKILL_DIRECTORIES = new Set([".system", "projects"]);
const SKIPPED_CLAUDE_SKILL_DIRECTORIES = new Set([".system", "projects"]);

const addDirectoryWithFiles = async (
  sources: ProviderGlobalGuidanceSource[],
  provider: ProviderGlobalGuidanceProvider,
  directoryPath: string,
): Promise<void> => {
  sources.push({
    provider,
    entryType: "directory",
    path: directoryPath,
    relativePath: toHomeRelativePath(directoryPath),
    fingerprint: await fingerprintGuidancePath(directoryPath, "directory"),
  });

  const nestedFilePaths = await listFilesRecursively(directoryPath);
  for (const nestedFilePath of nestedFilePaths) {
    sources.push({
      provider,
      entryType: "file",
      path: nestedFilePath,
      relativePath: toHomeRelativePath(nestedFilePath),
      fingerprint: await fingerprintGuidancePath(nestedFilePath, "file"),
    });
  }
};

const discoverCodexGlobalGuidance = async (homePath: string): Promise<ProviderGlobalGuidanceSource[]> => {
  const sources: ProviderGlobalGuidanceSource[] = [];
  const codexSkillsRoot = path.join(homePath, ".codex", "skills");
  const codexRulesRoot = path.join(homePath, ".codex", "rules");

  if (await pathExists(codexSkillsRoot)) {
    const entries = await fs.readdir(codexSkillsRoot, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || SKIPPED_CODEX_SKILL_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await addDirectoryWithFiles(sources, "codex", path.join(codexSkillsRoot, entry.name));
    }
  }

  if (await pathExists(codexRulesRoot)) {
    await addDirectoryWithFiles(sources, "codex", codexRulesRoot);
  }

  return sources;
};

const discoverClaudeGlobalGuidance = async (homePath: string): Promise<ProviderGlobalGuidanceSource[]> => {
  const sources: ProviderGlobalGuidanceSource[] = [];
  const claudeRoot = path.join(homePath, ".claude");
  const claudeRulesRoot = path.join(claudeRoot, "rules");
  const claudeSkillsRoot = path.join(claudeRoot, "skills");
  const claudeCommandsRoot = path.join(claudeRoot, "commands");
  const claudeMdPath = path.join(claudeRoot, "CLAUDE.md");

  if (await pathExists(claudeMdPath)) {
    sources.push({
      provider: "claude",
      entryType: "file",
      path: claudeMdPath,
      relativePath: toHomeRelativePath(claudeMdPath),
      fingerprint: await fingerprintGuidancePath(claudeMdPath, "file"),
    });
  }

  if (await pathExists(claudeRulesRoot)) {
    await addDirectoryWithFiles(sources, "claude", claudeRulesRoot);
  }

  if (await pathExists(claudeSkillsRoot)) {
    const entries = await fs.readdir(claudeSkillsRoot, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || SKIPPED_CLAUDE_SKILL_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await addDirectoryWithFiles(sources, "claude", path.join(claudeSkillsRoot, entry.name));
    }
  }

  if (await pathExists(claudeCommandsRoot)) {
    await addDirectoryWithFiles(sources, "claude", claudeCommandsRoot);
  }

  return sources;
};

export const discoverProviderGlobalGuidance = async (): Promise<ProviderGlobalGuidanceSource[]> => {
  const homePath = getHomePath();
  const sources = [
    ...(await discoverCodexGlobalGuidance(homePath)),
    ...(await discoverClaudeGlobalGuidance(homePath)),
  ];

  return sources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};
