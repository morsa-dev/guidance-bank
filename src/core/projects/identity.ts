import { createHash } from "node:crypto";
import path from "node:path";

export type ProjectIdentity = {
  projectId: string;
  projectName: string;
  projectPath: string;
};

const normalizeProjectPath = (projectPath: string): string => {
  const resolvedPath = path.resolve(projectPath);
  return resolvedPath.endsWith(path.sep) ? resolvedPath.slice(0, -1) : resolvedPath;
};

export const resolveProjectIdentity = (projectPath: string): ProjectIdentity => {
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const projectName = path.basename(normalizedProjectPath);
  const hash = createHash("sha256").update(normalizedProjectPath).digest("hex").slice(0, 12);

  return {
    projectId: `${projectName}-${hash}`,
    projectName,
    projectPath: normalizedProjectPath,
  };
};
