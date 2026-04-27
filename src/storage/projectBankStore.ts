import path from "node:path";

import { parseProjectBankManifest, parseProjectBankState } from "../core/bank/project.js";
import { resolveBankPaths } from "../core/bank/layout.js";
import type { ProjectBankManifest, ProjectBankState } from "../core/bank/types.js";
import {
  deleteManagedDirectory,
  ensureManagedDirectory,
  listManagedChildDirectories,
  managedPathExists,
  readManagedJsonFile,
  writeManagedJsonFile,
} from "./safeFs.js";

type BankPaths = ReturnType<typeof resolveBankPaths>;

export class ProjectBankStore {
  constructor(
    private readonly rootPath: string,
    private readonly paths: BankPaths,
  ) {}

  async ensureProjectStructure(projectId: string): Promise<void> {
    await ensureManagedDirectory(this.rootPath, this.paths.projectDirectory(projectId));
    await ensureManagedDirectory(this.rootPath, this.paths.projectRulesDirectory(projectId));
    await ensureManagedDirectory(this.rootPath, this.paths.projectSkillsDirectory(projectId));
  }

  async writeProjectManifest(projectId: string, manifest: ProjectBankManifest): Promise<void> {
    await this.ensureProjectStructure(projectId);
    await writeManagedJsonFile(this.rootPath, this.paths.projectManifestFile(projectId), manifest);
  }

  async readProjectManifestOptional(projectId: string): Promise<ProjectBankManifest | null> {
    const manifestFilePath = this.paths.projectManifestFile(projectId);
    if (!(await managedPathExists(this.rootPath, manifestFilePath))) {
      return null;
    }

    const manifest = await readManagedJsonFile<unknown>(this.rootPath, manifestFilePath);
    return parseProjectBankManifest(manifest);
  }

  async listProjectManifests(): Promise<ProjectBankManifest[]> {
    const projectDirectoryPaths = await listManagedChildDirectories(this.rootPath, this.paths.projectsDirectory);
    const manifests = await Promise.all(
      projectDirectoryPaths.map(async (projectDirectoryPath) => {
        const projectId = path.basename(projectDirectoryPath);
        return this.readProjectManifestOptional(projectId);
      }),
    );

    return manifests.filter((manifest): manifest is ProjectBankManifest => manifest !== null);
  }

  async writeProjectState(projectId: string, state: ProjectBankState): Promise<void> {
    await this.ensureProjectStructure(projectId);
    await writeManagedJsonFile(this.rootPath, this.paths.projectStateFile(projectId), state);
  }

  async readProjectStateOptional(projectId: string): Promise<ProjectBankState | null> {
    const stateFilePath = this.paths.projectStateFile(projectId);
    if (!(await managedPathExists(this.rootPath, stateFilePath))) {
      return null;
    }

    const state = await readManagedJsonFile<unknown>(this.rootPath, stateFilePath);
    return parseProjectBankState(state);
  }

  async deleteProjectBank(projectId: string): Promise<boolean> {
    return deleteManagedDirectory(this.rootPath, this.paths.projectDirectory(projectId));
  }
}
