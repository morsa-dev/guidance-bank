import path from "node:path";

import type { AuditEvent } from "../audit/types.js";
import { BankRepository } from "../../storage/bankRepository.js";
import { resolveBankRoot } from "../../shared/paths.js";
import type {
  EntryScope,
  MemoryBankManifest,
  ProjectBankManifest,
  ProjectBankState,
  ProviderId,
} from "../bank/types.js";

type EntryCounts = {
  rules: number;
  skills: number;
};

type EventSummary = {
  timestamp: string;
  provider: ProviderId | null;
  tool: AuditEvent["tool"];
  action: AuditEvent["action"];
  projectId: string;
  projectPath: string;
  providerSessionId: string | null;
  providerSessionSource: AuditEvent["providerSessionSource"];
};

type ProjectStats = {
  projectId: string;
  projectName: string;
  projectPath: string;
  detectedStacks: string[];
  creationState: ProjectBankState["creationState"] | "unknown";
  updatedAt: string;
  entries: EntryCounts;
  audit: {
    totalEvents: number;
    latestEvents: EventSummary[];
    byTool: Record<string, number>;
    byProvider: Record<string, number>;
  };
};

export type MemoryBankStats = {
  bankRoot: string;
  manifest: Pick<MemoryBankManifest, "bankId" | "storageVersion" | "createdAt" | "updatedAt" | "enabledProviders" | "defaultMcpTransport">;
  sharedEntries: EntryCounts;
  projects: {
    total: number;
    byCreationState: Record<string, number>;
  };
  audit: {
    totalEvents: number;
    byTool: Record<string, number>;
    byProvider: Record<string, number>;
    latestEvents: EventSummary[];
  };
  project?: ProjectStats;
};

const incrementCount = (bucket: Record<string, number>, key: string): void => {
  bucket[key] = (bucket[key] ?? 0) + 1;
};

const isDocumentationEntry = (entryPath: string): boolean => {
  const normalizedEntryPath = entryPath.replaceAll("\\", "/").toLowerCase();
  return normalizedEntryPath.endsWith("/readme.md") || normalizedEntryPath === "readme.md";
};

const summarizeEvents = (events: readonly AuditEvent[], limit: number): EventSummary[] =>
  [...events]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, limit)
    .map((event) => ({
      timestamp: event.timestamp,
      provider: event.provider,
      tool: event.tool,
      action: event.action,
      projectId: event.projectId,
      projectPath: event.projectPath,
      providerSessionId: event.providerSessionId,
      providerSessionSource: event.providerSessionSource,
    }));

const summarizeEventsByKey = <T extends string>(
  events: readonly AuditEvent[],
  selector: (event: AuditEvent) => T,
): Record<string, number> => {
  const counts: Record<string, number> = {};

  for (const event of events) {
    incrementCount(counts, selector(event));
  }

  return counts;
};

const countEntries = async (
  repository: BankRepository,
  scope: EntryScope,
  projectId?: string,
): Promise<EntryCounts> => {
  const rules = await repository.listLayerEntries(scope, "rules", projectId);
  const skills = await repository.listLayerEntries(scope, "skills", projectId);

  return {
    rules: rules.filter((entry) => !isDocumentationEntry(entry.path)).length,
    skills: skills.filter((entry) => !isDocumentationEntry(entry.path)).length,
  };
};

const resolveProjectFilter = (
  manifests: readonly ProjectBankManifest[],
  projectPath?: string,
): ProjectBankManifest | null => {
  if (!projectPath) {
    return null;
  }

  const resolvedProjectPath = path.resolve(projectPath);
  return manifests.find((manifest) => path.resolve(manifest.projectPath) === resolvedProjectPath) ?? null;
};

export class StatsService {
  private readonly repository: BankRepository;

  constructor(bankRoot?: string) {
    this.repository = new BankRepository(resolveBankRoot(bankRoot));
  }

  async collect(options?: { projectPath?: string; latestEventsLimit?: number }): Promise<MemoryBankStats> {
    const latestEventsLimit = options?.latestEventsLimit ?? 10;
    const manifest = await this.repository.readManifestOptional();

    if (manifest === null) {
      throw new Error(`AI Guidance Bank is not initialized at ${this.repository.rootPath}. Run \`gbank init\` first.`);
    }

    const projectManifests = await this.repository.listProjectManifests();
    const auditEvents = await this.repository.readAuditEventsOptional();
    const sharedEntries = await countEntries(this.repository, "shared");
    const projectCountsByState: Record<string, number> = {};

    for (const projectManifest of projectManifests) {
      const state = await this.repository.readProjectStateOptional(projectManifest.projectId);
      incrementCount(projectCountsByState, state?.creationState ?? "unknown");
    }

    const matchedProject = resolveProjectFilter(projectManifests, options?.projectPath);
    let projectStats: ProjectStats | undefined;

    if (options?.projectPath) {
      if (matchedProject === null) {
        throw new Error(`No project bank found for ${path.resolve(options.projectPath)}.`);
      }

      const projectState = await this.repository.readProjectStateOptional(matchedProject.projectId);
      const projectEntries = await countEntries(this.repository, "project", matchedProject.projectId);
      const projectEvents = auditEvents.filter((event) => event.projectId === matchedProject.projectId);

      projectStats = {
        projectId: matchedProject.projectId,
        projectName: matchedProject.projectName,
        projectPath: matchedProject.projectPath,
        detectedStacks: matchedProject.detectedStacks,
        creationState: projectState?.creationState ?? "unknown",
        updatedAt: projectState?.updatedAt ?? matchedProject.updatedAt,
        entries: projectEntries,
        audit: {
          totalEvents: projectEvents.length,
          latestEvents: summarizeEvents(projectEvents, latestEventsLimit),
          byTool: summarizeEventsByKey(projectEvents, (event) => event.tool),
          byProvider: summarizeEventsByKey(projectEvents, (event) => event.provider ?? "unknown"),
        },
      };
    }

    return {
      bankRoot: this.repository.rootPath,
      manifest: {
        bankId: manifest.bankId,
        storageVersion: manifest.storageVersion,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        enabledProviders: manifest.enabledProviders,
        defaultMcpTransport: manifest.defaultMcpTransport,
      },
      sharedEntries,
      projects: {
        total: projectManifests.length,
        byCreationState: projectCountsByState,
      },
      audit: {
        totalEvents: auditEvents.length,
        byTool: summarizeEventsByKey(auditEvents, (event) => event.tool),
        byProvider: summarizeEventsByKey(auditEvents, (event) => event.provider ?? "unknown"),
        latestEvents: summarizeEvents(auditEvents, latestEventsLimit),
      },
      ...(projectStats
        ? {
            project: projectStats,
          }
        : {}),
    };
  }
}
