import {
  createExternalGuidanceDecisionState,
  parseExternalGuidanceDecisionState,
  type ExternalGuidanceDecisionState,
} from "../core/bank/externalGuidanceDecisions.js";
import { resolveBankPaths } from "../core/bank/layout.js";
import { managedPathExists, readManagedJsonFile, writeManagedJsonFile } from "./safeFs.js";

type BankPaths = ReturnType<typeof resolveBankPaths>;

export class ExternalGuidanceDecisionStore {
  constructor(
    private readonly rootPath: string,
    private readonly paths: BankPaths,
  ) {}

  async readStateOptional(): Promise<ExternalGuidanceDecisionState | null> {
    if (!(await managedPathExists(this.rootPath, this.paths.externalGuidanceDecisionsFile))) {
      return null;
    }

    const state = await readManagedJsonFile<unknown>(this.rootPath, this.paths.externalGuidanceDecisionsFile);
    return parseExternalGuidanceDecisionState(state);
  }

  async readState(): Promise<ExternalGuidanceDecisionState> {
    return (await this.readStateOptional()) ?? createExternalGuidanceDecisionState();
  }

  async writeState(state: ExternalGuidanceDecisionState): Promise<void> {
    await writeManagedJsonFile(this.rootPath, this.paths.externalGuidanceDecisionsFile, state);
  }
}
