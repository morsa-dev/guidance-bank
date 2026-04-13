import { parseArgs } from "node:util";

import { StatsService, type MemoryBankStats } from "../../core/stats/statsService.js";
import { GuidanceBankCliError, UserInputError } from "../../shared/errors.js";

const printStatsUsage = (): void => {
  console.info("Usage: gbank stats [--project /absolute/project/path] [--json]");
};

const renderCountMap = (label: string, values: Record<string, number>): string[] => {
  const entries = Object.entries(values).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

  if (entries.length === 0) {
    return [`${label}: none`];
  }

  return [
    `${label}:`,
    ...entries.map(([key, count]) => `  - ${key}: ${count}`),
  ];
};

const renderLatestEvents = (label: string, events: MemoryBankStats["audit"]["latestEvents"]): string[] => {
  if (events.length === 0) {
    return [`${label}: none`];
  }

  return [
    `${label}:`,
    ...events.map((event) => `  - ${event.timestamp}  ${event.tool}  provider=${event.provider ?? "unknown"}  project=${event.projectId}  session=${event.sessionRef ?? "none"}`),
  ];
};

const renderTextStats = (stats: MemoryBankStats): string => {
  const lines = [
    `AI Guidance Bank at ${stats.bankRoot}`,
    "",
    `Bank ID: ${stats.manifest.bankId}`,
    `Storage version: ${stats.manifest.storageVersion}`,
    `Providers: ${stats.manifest.enabledProviders.join(", ") || "none"}`,
    `Transport: ${stats.manifest.defaultMcpTransport}`,
    `Updated: ${stats.manifest.updatedAt}`,
    "",
    `Shared entries: rules=${stats.sharedEntries.rules}, skills=${stats.sharedEntries.skills}`,
    `Project banks: ${stats.projects.total}`,
    ...renderCountMap("Project creation states", stats.projects.byCreationState),
    "",
    `Audit events: ${stats.audit.totalEvents}`,
    ...renderCountMap("Events by tool", stats.audit.byTool),
    ...renderCountMap("Events by provider", stats.audit.byProvider),
    ...renderLatestEvents("Latest events", stats.audit.latestEvents),
  ];

  if (!stats.project) {
    return lines.join("\n");
  }

  lines.push(
    "",
    `Project: ${stats.project.projectName}`,
    `Project ID: ${stats.project.projectId}`,
    `Project path: ${stats.project.projectPath}`,
    `Project state: ${stats.project.creationState}`,
    `Detected stacks: ${stats.project.detectedStacks.join(", ") || "none"}`,
    `Project entries: rules=${stats.project.entries.rules}, skills=${stats.project.entries.skills}`,
    `Project updated: ${stats.project.updatedAt}`,
    `Project audit events: ${stats.project.audit.totalEvents}`,
    ...renderCountMap("Project events by tool", stats.project.audit.byTool),
    ...renderCountMap("Project events by provider", stats.project.audit.byProvider),
    ...renderLatestEvents("Latest project events", stats.project.audit.latestEvents),
  );

  return lines.join("\n");
};

export const runStatsCommand = async (argv: readonly string[] = process.argv.slice(2)): Promise<void> => {
  const parsedArgs = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: {
        type: "boolean",
        short: "h",
      },
      project: {
        type: "string",
      },
      json: {
        type: "boolean",
      },
    },
  });

  if (parsedArgs.values.help) {
    printStatsUsage();
    return;
  }

  if (parsedArgs.positionals.length > 1 || (parsedArgs.positionals[0] && parsedArgs.positionals[0] !== "stats")) {
    throw new UserInputError("Usage: gbank stats [--project /absolute/project/path] [--json]");
  }

  const statsService = new StatsService();

  try {
    const stats = await statsService.collect(
      parsedArgs.values.project
        ? {
            projectPath: parsedArgs.values.project,
          }
        : undefined,
    );

    if (parsedArgs.values.json) {
      console.info(JSON.stringify(stats, null, 2));
      return;
    }

    console.info(renderTextStats(stats));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown stats error.";
    throw new GuidanceBankCliError(message);
  }
};
