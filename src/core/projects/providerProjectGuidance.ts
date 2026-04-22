import os from "node:os";
import path from "node:path";

import { fingerprintGuidancePath, listFilesRecursively, pathExists } from "./guidanceFingerprint.js";

export type ProviderProjectGuidanceProvider = "codex" | "cursor" | "claude";
export type ProviderProjectGuidanceEntryType = "file" | "directory";

export type ProviderProjectGuidanceSource = {
  provider: ProviderProjectGuidanceProvider;
  entryType: ProviderProjectGuidanceEntryType;
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

const getCandidateRoots = (projectPath: string): Array<{ provider: ProviderProjectGuidanceProvider; rootPath: string }> => {
  const projectName = path.basename(path.resolve(projectPath));
  const homePath = getHomePath();

  return [
    {
      provider: "codex",
      rootPath: path.join(homePath, ".codex", "skills", "projects", projectName),
    },
  ];
};

export const discoverProviderProjectGuidance = async (projectPath: string): Promise<ProviderProjectGuidanceSource[]> => {
  const discoveredSources: ProviderProjectGuidanceSource[] = [];

  for (const candidate of getCandidateRoots(projectPath)) {
    if (!(await pathExists(candidate.rootPath))) {
      continue;
    }

    discoveredSources.push({
      provider: candidate.provider,
      entryType: "directory",
      path: candidate.rootPath,
      relativePath: toHomeRelativePath(candidate.rootPath),
      fingerprint: await fingerprintGuidancePath(candidate.rootPath, "directory"),
    });

    const nestedFilePaths = await listFilesRecursively(candidate.rootPath);
    for (const nestedFilePath of nestedFilePaths) {
      discoveredSources.push({
        provider: candidate.provider,
        entryType: "file",
        path: nestedFilePath,
        relativePath: toHomeRelativePath(nestedFilePath),
        fingerprint: await fingerprintGuidancePath(nestedFilePath, "file"),
      });
    }
  }

  return discoveredSources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};
