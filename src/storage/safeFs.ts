import { promises as fs } from "node:fs";
import path from "node:path";

import { ValidationError } from "../shared/errors.js";
import { atomicWriteFile } from "./atomicWrite.js";

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const assertPathInsideRoot = (rootPath: string, targetPath: string): { rootPath: string; targetPath: string } => {
  const resolvedRootPath = path.resolve(rootPath);
  const resolvedTargetPath = path.resolve(targetPath);
  const relativePath = path.relative(resolvedRootPath, resolvedTargetPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new ValidationError(`Path escapes managed root: ${resolvedTargetPath}`);
  }

  return {
    rootPath: resolvedRootPath,
    targetPath: resolvedTargetPath,
  };
};

const assertExistingSegmentsAreSafe = async (rootPath: string, targetPath: string): Promise<void> => {
  const segments = path.relative(rootPath, targetPath).split(path.sep).filter(Boolean);
  let currentPath = rootPath;

  if (await pathExists(currentPath)) {
    const stats = await fs.lstat(currentPath);
    if (stats.isSymbolicLink()) {
      throw new ValidationError(`Managed root cannot be a symbolic link: ${currentPath}`);
    }
  }

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    if (!(await pathExists(currentPath))) {
      continue;
    }

    const stats = await fs.lstat(currentPath);
    if (stats.isSymbolicLink()) {
      throw new ValidationError(`Managed path cannot contain symbolic links: ${currentPath}`);
    }
  }
};

export const ensureManagedDirectory = async (rootPath: string, directoryPath: string): Promise<void> => {
  const managedPaths = assertPathInsideRoot(rootPath, directoryPath);
  const segments = path.relative(managedPaths.rootPath, managedPaths.targetPath).split(path.sep).filter(Boolean);
  let currentPath = managedPaths.rootPath;

  if (await pathExists(currentPath)) {
    const rootStats = await fs.lstat(currentPath);
    if (rootStats.isSymbolicLink()) {
      throw new ValidationError(`Managed root cannot be a symbolic link: ${currentPath}`);
    }
    if (!rootStats.isDirectory()) {
      throw new ValidationError(`Managed root must be a directory: ${currentPath}`);
    }
  } else {
    await fs.mkdir(currentPath, { recursive: false });
  }

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);

    if (await pathExists(currentPath)) {
      const stats = await fs.lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new ValidationError(`Managed path cannot contain symbolic links: ${currentPath}`);
      }
      if (!stats.isDirectory()) {
        throw new ValidationError(`Expected directory but found file: ${currentPath}`);
      }
      continue;
    }

    await fs.mkdir(currentPath, { recursive: false });
  }
};

export const writeManagedTextFile = async (rootPath: string, filePath: string, content: string): Promise<void> => {
  const managedPaths = assertPathInsideRoot(rootPath, filePath);
  await ensureManagedDirectory(managedPaths.rootPath, path.dirname(managedPaths.targetPath));
  await assertExistingSegmentsAreSafe(managedPaths.rootPath, managedPaths.targetPath);

  if (await pathExists(managedPaths.targetPath)) {
    const stats = await fs.lstat(managedPaths.targetPath);
    if (stats.isSymbolicLink()) {
      throw new ValidationError(`Managed file cannot be a symbolic link: ${managedPaths.targetPath}`);
    }
  }

  await atomicWriteFile(managedPaths.targetPath, content);
};

export const appendManagedTextFile = async (rootPath: string, filePath: string, content: string): Promise<void> => {
  const managedPaths = assertPathInsideRoot(rootPath, filePath);
  await ensureManagedDirectory(managedPaths.rootPath, path.dirname(managedPaths.targetPath));
  await assertExistingSegmentsAreSafe(managedPaths.rootPath, managedPaths.targetPath);

  if (await pathExists(managedPaths.targetPath)) {
    const stats = await fs.lstat(managedPaths.targetPath);
    if (stats.isSymbolicLink()) {
      throw new ValidationError(`Managed file cannot be a symbolic link: ${managedPaths.targetPath}`);
    }
    if (!stats.isFile()) {
      throw new ValidationError(`Expected file but found non-file path: ${managedPaths.targetPath}`);
    }
  }

  const handle = await fs.open(managedPaths.targetPath, "a", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const writeManagedJsonFile = async (rootPath: string, filePath: string, value: unknown): Promise<void> => {
  await writeManagedTextFile(rootPath, filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const readManagedTextFile = async (rootPath: string, filePath: string): Promise<string> => {
  const managedPaths = assertPathInsideRoot(rootPath, filePath);
  await assertExistingSegmentsAreSafe(managedPaths.rootPath, managedPaths.targetPath);

  return fs.readFile(managedPaths.targetPath, "utf8");
};

export const readManagedJsonFile = async <T>(rootPath: string, filePath: string): Promise<T> => {
  const content = await readManagedTextFile(rootPath, filePath);
  return JSON.parse(content) as T;
};

export const managedPathExists = async (rootPath: string, targetPath: string): Promise<boolean> => {
  const managedPaths = assertPathInsideRoot(rootPath, targetPath);
  await assertExistingSegmentsAreSafe(managedPaths.rootPath, path.dirname(managedPaths.targetPath));
  return pathExists(managedPaths.targetPath);
};

export const writeManagedTextFileIfMissing = async (
  rootPath: string,
  filePath: string,
  content: string,
): Promise<boolean> => {
  if (await managedPathExists(rootPath, filePath)) {
    return false;
  }

  await writeManagedTextFile(rootPath, filePath, content);
  return true;
};

export const listManagedFilesRecursively = async (
  rootPath: string,
  startDirectoryPath: string,
): Promise<string[]> => {
  const managedPaths = assertPathInsideRoot(rootPath, startDirectoryPath);
  await assertExistingSegmentsAreSafe(managedPaths.rootPath, managedPaths.targetPath);

  if (!(await pathExists(managedPaths.targetPath))) {
    return [];
  }

  const entries = await fs.readdir(managedPaths.targetPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(managedPaths.targetPath, entry.name);

    if (entry.isDirectory()) {
      const nestedPaths = await listManagedFilesRecursively(managedPaths.rootPath, entryPath);
      filePaths.push(...nestedPaths);
      continue;
    }

    if (entry.isFile()) {
      filePaths.push(entryPath);
    }
  }

  return filePaths.sort((left, right) => left.localeCompare(right));
};

export const listManagedChildDirectories = async (
  rootPath: string,
  startDirectoryPath: string,
): Promise<string[]> => {
  const managedPaths = assertPathInsideRoot(rootPath, startDirectoryPath);
  await assertExistingSegmentsAreSafe(managedPaths.rootPath, managedPaths.targetPath);

  if (!(await pathExists(managedPaths.targetPath))) {
    return [];
  }

  const entries = await fs.readdir(managedPaths.targetPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(managedPaths.targetPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
};

export const deleteManagedFile = async (rootPath: string, filePath: string): Promise<boolean> => {
  const managedPaths = assertPathInsideRoot(rootPath, filePath);
  await assertExistingSegmentsAreSafe(managedPaths.rootPath, path.dirname(managedPaths.targetPath));

  if (!(await pathExists(managedPaths.targetPath))) {
    return false;
  }

  const stats = await fs.lstat(managedPaths.targetPath);
  if (stats.isSymbolicLink()) {
    throw new ValidationError(`Managed file cannot be a symbolic link: ${managedPaths.targetPath}`);
  }
  if (!stats.isFile()) {
    throw new ValidationError(`Expected file but found non-file path: ${managedPaths.targetPath}`);
  }

  await fs.unlink(managedPaths.targetPath);
  return true;
};

export const deleteManagedDirectory = async (rootPath: string, directoryPath: string): Promise<boolean> => {
  const managedPaths = assertPathInsideRoot(rootPath, directoryPath);

  if (managedPaths.rootPath === managedPaths.targetPath) {
    throw new ValidationError("Refusing to delete the managed root directory.");
  }

  await assertExistingSegmentsAreSafe(managedPaths.rootPath, path.dirname(managedPaths.targetPath));

  if (!(await pathExists(managedPaths.targetPath))) {
    return false;
  }

  const stats = await fs.lstat(managedPaths.targetPath);
  if (stats.isSymbolicLink()) {
    throw new ValidationError(`Managed directory cannot be a symbolic link: ${managedPaths.targetPath}`);
  }
  if (!stats.isDirectory()) {
    throw new ValidationError(`Expected directory but found non-directory path: ${managedPaths.targetPath}`);
  }

  await fs.rm(managedPaths.targetPath, { recursive: true, force: false });
  return true;
};
