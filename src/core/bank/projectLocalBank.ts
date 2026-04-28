import path from "node:path";

import { BANK_DIRECTORY_NAME } from "../../shared/paths.js";
import { ensureManagedDirectory } from "../../storage/safeFs.js";

export type ProjectLocalBankPaths = {
  root: string;
  rulesDirectory: string;
  skillsDirectory: string;
};

export const resolveProjectLocalBankPaths = (projectPath: string): ProjectLocalBankPaths => {
  const root = path.join(projectPath, BANK_DIRECTORY_NAME);
  return {
    root,
    rulesDirectory: path.join(root, "rules"),
    skillsDirectory: path.join(root, "skills"),
  };
};

export const ensureProjectLocalBankStructure = async (projectPath: string): Promise<void> => {
  const paths = resolveProjectLocalBankPaths(projectPath);
  await ensureManagedDirectory(paths.root, paths.root);
  await ensureManagedDirectory(paths.root, paths.rulesDirectory);
  await ensureManagedDirectory(paths.root, paths.skillsDirectory);
};
