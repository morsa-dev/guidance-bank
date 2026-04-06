import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

export type ProviderProjectGuidanceProvider = "codex" | "cursor" | "claude";
export type ProviderProjectGuidanceEntryType = "file" | "directory";

export type ProviderProjectGuidanceSource = {
  provider: ProviderProjectGuidanceProvider;
  entryType: ProviderProjectGuidanceEntryType;
  path: string;
  relativePath: string;
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const getHomePath = (): string => process.env.HOME ?? os.homedir();

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

const toHomeRelativePath = (targetPath: string): string => {
  const homePath = getHomePath();
  const relativeToHome = path.relative(homePath, targetPath);

  return relativeToHome.startsWith("..") || path.isAbsolute(relativeToHome) ? targetPath : `~/${relativeToHome}`;
};

const encodeProjectPathForCursor = (projectPath: string): string =>
  path
    .resolve(projectPath)
    .split(path.sep)
    .filter(Boolean)
    .join("-")
    .replaceAll(" ", "-");

const encodeProjectPathForClaude = (projectPath: string): string => `-${encodeProjectPathForCursor(projectPath)}`;

const getCandidateRoots = (projectPath: string): Array<{ provider: ProviderProjectGuidanceProvider; rootPath: string }> => {
  const projectName = path.basename(path.resolve(projectPath));
  const homePath = getHomePath();

  return [
    {
      provider: "codex",
      rootPath: path.join(homePath, ".codex", "skills", "projects", projectName),
    },
    {
      provider: "cursor",
      rootPath: path.join(homePath, ".cursor", "projects", encodeProjectPathForCursor(projectPath), "rules"),
    },
    {
      provider: "claude",
      rootPath: path.join(homePath, ".claude", "projects", encodeProjectPathForClaude(projectPath), "skills"),
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
    });

    const nestedFilePaths = await listFilesRecursively(candidate.rootPath);
    for (const nestedFilePath of nestedFilePaths) {
      discoveredSources.push({
        provider: candidate.provider,
        entryType: "file",
        path: nestedFilePath,
        relativePath: toHomeRelativePath(nestedFilePath),
      });
    }
  }

  return discoveredSources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};
