import { randomUUID } from "node:crypto";

import type { ProviderId } from "../core/bank/types.js";
import { resolveBankPaths } from "../core/bank/layout.js";
import type { AuditEvent } from "../core/audit/types.js";
import { appendManagedTextFile } from "./safeFs.js";

type AuditLoggerOptions = {
  bankRoot: string;
  provider: ProviderId | null;
};

type WriteAuditEventInput = Omit<AuditEvent, "schemaVersion" | "eventId" | "timestamp" | "provider">;

export class AuditLogger {
  private readonly paths;

  constructor(
    private readonly options: AuditLoggerOptions,
  ) {
    this.paths = resolveBankPaths(options.bankRoot);
  }

  async writeEvent(event: WriteAuditEventInput): Promise<void> {
    await appendManagedTextFile(
      this.options.bankRoot,
      this.paths.auditEventsFile,
      `${JSON.stringify({
        schemaVersion: 1,
        eventId: randomUUID(),
        timestamp: new Date().toISOString(),
        provider: this.options.provider,
        ...event,
      } satisfies AuditEvent)}\n`,
    );
  }
}
