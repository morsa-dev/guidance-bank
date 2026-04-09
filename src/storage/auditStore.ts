import { readFile } from "node:fs/promises";

import { resolveBankPaths } from "../core/bank/layout.js";
import type { AuditEvent } from "../core/audit/types.js";
import { managedPathExists } from "./safeFs.js";

type BankPaths = ReturnType<typeof resolveBankPaths>;

export class AuditStore {
  constructor(
    private readonly rootPath: string,
    private readonly paths: BankPaths,
  ) {}

  async readEventsOptional(): Promise<AuditEvent[]> {
    if (!(await managedPathExists(this.rootPath, this.paths.auditEventsFile))) {
      return [];
    }

    const content = await readFile(this.paths.auditEventsFile, "utf8");

    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as AuditEvent);
  }
}
