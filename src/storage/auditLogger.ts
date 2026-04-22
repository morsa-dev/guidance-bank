import { randomUUID } from "node:crypto";

import type { ProviderId } from "../core/bank/types.js";
import { resolveBankPaths } from "../core/bank/layout.js";
import type {
  AuditEvent,
  EntryAuditEvent,
  EntryVersionEvent,
  GuidanceSourceVersionEvent,
  ToolAuditEvent,
} from "../core/audit/types.js";
import { appendManagedTextFile } from "./safeFs.js";

type AuditLoggerOptions = {
  bankRoot: string;
  provider: ProviderId | null;
};

type WriteAuditEventInput =
  | Omit<EntryAuditEvent, "schemaVersion" | "eventId" | "timestamp" | "provider">
  | Omit<ToolAuditEvent, "schemaVersion" | "eventId" | "timestamp" | "provider">;

type WriteEntryVersionEventInput = Omit<EntryVersionEvent, "schemaVersion" | "eventId" | "timestamp" | "provider">;
type WriteGuidanceSourceVersionEventInput = Omit<
  GuidanceSourceVersionEvent,
  "schemaVersion" | "eventId" | "timestamp" | "provider"
>;

export class AuditLogger {
  private readonly paths;

  constructor(
    private readonly options: AuditLoggerOptions,
  ) {
    this.paths = resolveBankPaths(options.bankRoot);
  }

  async writeEvent(event: WriteAuditEventInput): Promise<AuditEvent> {
    const auditEvent = {
      schemaVersion: 1,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      provider: this.options.provider,
      ...event,
    } satisfies AuditEvent;

    await appendManagedTextFile(
      this.options.bankRoot,
      this.paths.auditEventsFile,
      `${JSON.stringify(auditEvent)}\n`,
    );

    return auditEvent;
  }

  async writeEntryVersion(event: WriteEntryVersionEventInput): Promise<EntryVersionEvent> {
    const versionEvent = {
      schemaVersion: 1,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      provider: this.options.provider,
      ...event,
    } satisfies EntryVersionEvent;

    await appendManagedTextFile(
      this.options.bankRoot,
      this.paths.entryHistoryEventsFile,
      `${JSON.stringify(versionEvent)}\n`,
    );

    return versionEvent;
  }

  async writeGuidanceSourceVersion(
    event: WriteGuidanceSourceVersionEventInput,
  ): Promise<GuidanceSourceVersionEvent> {
    const versionEvent = {
      schemaVersion: 1,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      provider: this.options.provider,
      ...event,
    } satisfies GuidanceSourceVersionEvent;

    await appendManagedTextFile(
      this.options.bankRoot,
      this.paths.guidanceSourceHistoryEventsFile,
      `${JSON.stringify(versionEvent)}\n`,
    );

    return versionEvent;
  }
}
