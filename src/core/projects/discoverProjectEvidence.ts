import path from "node:path";
import { promises as fs } from "node:fs";

export type ProjectEvidenceFileKind = "config" | "doc";

export type ProjectEvidenceFile = {
  kind: ProjectEvidenceFileKind;
  relativePath: string;
};

export type ProjectEvidenceInventory = {
  topLevelDirectories: string[];
  evidenceFiles: ProjectEvidenceFile[];
};

const topLevelDirectoryCandidates = ["src", "app", "pages", "lib", "server", "packages", "scripts", "test", "tests", "docs"];
const configFileCandidates = [
  "package.json",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.base.json",
  "angular.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
];
const rootDocCandidates = ["README.md", "README.mdx", "docs.md"];

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const listMarkdownFilesRecursively = async (directoryPath: string): Promise<string[]> => {
  const directoryEntries = await fs.readdir(directoryPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const directoryEntry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directoryPath, directoryEntry.name);

    if (directoryEntry.isDirectory()) {
      filePaths.push(...(await listMarkdownFilesRecursively(entryPath)));
      continue;
    }

    if (directoryEntry.isFile() && /\.(md|mdx)$/iu.test(directoryEntry.name)) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
};

export const discoverProjectEvidence = async (projectPath: string): Promise<ProjectEvidenceInventory> => {
  const resolvedProjectPath = path.resolve(projectPath);
  const topLevelDirectories: string[] = [];
  const evidenceFiles: ProjectEvidenceFile[] = [];

  for (const directoryName of topLevelDirectoryCandidates) {
    const candidatePath = path.join(resolvedProjectPath, directoryName);
    if (await pathExists(candidatePath)) {
      topLevelDirectories.push(directoryName);
    }
  }

  for (const fileName of configFileCandidates) {
    const candidatePath = path.join(resolvedProjectPath, fileName);
    if (await pathExists(candidatePath)) {
      evidenceFiles.push({
        kind: "config",
        relativePath: fileName,
      });
    }
  }

  for (const fileName of rootDocCandidates) {
    const candidatePath = path.join(resolvedProjectPath, fileName);
    if (await pathExists(candidatePath)) {
      evidenceFiles.push({
        kind: "doc",
        relativePath: fileName,
      });
    }
  }

  const docsDirectoryPath = path.join(resolvedProjectPath, "docs");
  if (await pathExists(docsDirectoryPath)) {
    const docsFilePaths = await listMarkdownFilesRecursively(docsDirectoryPath);
    for (const docsFilePath of docsFilePaths.slice(0, 12)) {
      evidenceFiles.push({
        kind: "doc",
        relativePath: path.relative(resolvedProjectPath, docsFilePath),
      });
    }
  }

  return {
    topLevelDirectories: topLevelDirectories.sort((left, right) => left.localeCompare(right)),
    evidenceFiles: evidenceFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
};
