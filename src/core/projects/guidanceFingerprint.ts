import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

export const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const listFilesRecursively = async (directoryPath: string): Promise<string[]> => {
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

export const fingerprintFile = async (filePath: string): Promise<string> => {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
};

export const fingerprintDirectory = async (directoryPath: string): Promise<string> => {
  const filePaths = await listFilesRecursively(directoryPath);
  const hash = createHash("sha256");

  for (const filePath of filePaths) {
    const relativePath = path.relative(directoryPath, filePath);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await fingerprintFile(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
};

export const fingerprintGuidancePath = async (
  targetPath: string,
  entryType: "file" | "directory",
): Promise<string> => (entryType === "file" ? fingerprintFile(targetPath) : fingerprintDirectory(targetPath));
