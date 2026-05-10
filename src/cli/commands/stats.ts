import { parseArgs } from "node:util";

import { StatsService, type MemoryBankStats } from "../../core/stats/statsService.js";
import type { SessionTokenStats } from "../../core/stats/tokenStatsService.js";
import { GuidanceBankCliError, UserInputError } from "../../shared/errors.js";

const printStatsUsage = (): void => {
  console.info("Usage: gbank stats [options]");
  console.info("");
  console.info("Options:");
  console.info("  --project <path>     Show stats for a specific project");
  console.info("  --session-id <id>    Show stats for a specific session");
  console.info("  --json               Output in JSON format");
  console.info("  -h, --help           Show this help message");
};

const formatTokens = (tokens: number): string => {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens.toString();
};

const formatPercent = (percent: number): string => {
  return `${percent.toFixed(1)}%`;
};

const renderTokenStats = (label: string, tokens: { input?: number; output?: number; total: number }): string[] => {
  const lines = [`${label}:`];
  
  if (tokens.input !== undefined && tokens.output !== undefined) {
    lines.push(`  Input:  ${formatTokens(tokens.input)} tokens`);
    lines.push(`  Output: ${formatTokens(tokens.output)} tokens`);
  }
  
  lines.push(`  Total:  ${formatTokens(tokens.total)} tokens`);
  
  return lines;
};

const renderBankOverhead = (bankTokens: { overhead: number }, totalTokens: number, overheadPercent: number): string[] => {
  return [
    "Bank overhead:",
    `  ${formatTokens(bankTokens.overhead)} tokens (${formatPercent(overheadPercent)} of total)`,
  ];
};

const renderProjectsList = (projects: NonNullable<MemoryBankStats["projects"]["list"]>): string[] => {
  if (projects.length === 0) {
    return ["Projects: none"];
  }

  return [
    "Projects:",
    ...projects.slice(0, 10).map(p => {
      const tokensInfo = p.tokens
        ? `${formatTokens(p.tokens.total)} tokens, ${formatPercent(p.tokens.bankOverheadPercent)} bank`
        : "no token data";
      return `  ${p.projectName}  (${tokensInfo})`;
    }),
    ...(projects.length > 10 ? [`  ... and ${projects.length - 10} more`] : []),
    "",
    "💡 Use --project <path> to see details for a specific project",
  ];
};

const renderSessionsList = (sessions: SessionTokenStats[]): string[] => {
  if (sessions.length === 0) {
    return ["Sessions: none"];
  }

  const recentSessions = sessions.slice(0, 10);

  return [
    "Recent sessions:",
    ...recentSessions.map((s: SessionTokenStats) => {
      const time = s.endTime ? new Date(s.endTime).toLocaleString() : "in progress";
      const tokensInfo = s.transcriptExists
        ? `${formatTokens(s.totalTokens.total)} tokens, ${formatPercent(s.bankOverheadPercent)} bank`
        : "no transcript";
      return `  ${s.sessionId.substring(0, 36)}  (${s.provider}, ${time}, ${tokensInfo})`;
    }),
    ...(sessions.length > 10 ? [`  ... and ${sessions.length - 10} more sessions`] : []),
    "",
    "💡 Use --session-id <id> to see detailed analysis",
  ];
};

const renderSessionDetails = (session: SessionTokenStats): string[] => {
  return [
    `Session: ${session.sessionId}`,
    `Provider: ${session.provider}`,
    `Project: ${session.projectPath}`,
    `Messages: ${session.messagesCount}`,
    "",
    ...renderTokenStats("Total tokens", session.totalTokens),
    "",
    "Bank usage:",
    `  Context: ${formatTokens(session.bankTokens.contextTokens)} tokens`,
    `  Tool calls: ${session.bankTokens.toolCalls}`,
    ...renderBankOverhead(session.bankTokens, session.totalTokens.total, session.bankOverheadPercent),
    "",
    `Transcript: ${session.transcriptExists ? session.transcriptPath : "not found"}`,
  ];
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
    ...events.map((event) => `  - ${event.timestamp}  ${event.tool}  provider=${event.provider ?? "unknown"}  project=${event.projectId}  session=${event.providerSessionId ?? "none"}  source=${event.providerSessionSource}`),
  ];
};

const renderTextStats = (stats: MemoryBankStats): string => {
  // Session-specific view
  if (stats.session) {
    const lines = [
      "AI Guidance Bank - Session Statistics",
      "",
      ...renderSessionDetails(stats.session),
    ];
    return lines.join("\n");
  }

  // Project-specific view
  if (stats.project) {
    const lines = [
      `AI Guidance Bank at ${stats.bankRoot}`,
      "",
      `Project: ${stats.project.projectName}`,
      `Project ID: ${stats.project.projectId}`,
      `Project path: ${stats.project.projectPath}`,
      `Project state: ${stats.project.creationState}`,
      `Detected stacks: ${stats.project.detectedStacks.join(", ") || "none"}`,
      "",
      `Project entries: rules=${stats.project.entries.rules}, skills=${stats.project.entries.skills}`,
      `Project updated: ${stats.project.updatedAt}`,
      "",
    ];

    if (stats.project.tokens) {
      lines.push(
        ...renderTokenStats("Total tokens", stats.project.tokens.totalTokens),
        "",
        ...renderBankOverhead(
          stats.project.tokens.bankTokens,
          stats.project.tokens.totalTokens.total,
          stats.project.tokens.bankOverheadPercent,
        ),
        "",
        ...renderSessionsList(stats.project.tokens.sessions),
        "",
      );
    }

    lines.push(
      `Project audit events: ${stats.project.audit.totalEvents}`,
      ...renderCountMap("Project events by tool", stats.project.audit.byTool),
      ...renderCountMap("Project events by provider", stats.project.audit.byProvider),
      ...renderLatestEvents("Latest project events", stats.project.audit.latestEvents),
    );

    return lines.join("\n");
  }

  // General overview
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
    "",
  ];

  if (stats.projects.list) {
    lines.push(...renderProjectsList(stats.projects.list), "");
  } else {
    lines.push(
      `Project banks: ${stats.projects.total}`,
      ...renderCountMap("Project creation states", stats.projects.byCreationState),
      "",
    );
  }

  lines.push(
    `Audit events: ${stats.audit.totalEvents}`,
    ...renderCountMap("Events by tool", stats.audit.byTool),
    ...renderCountMap("Events by provider", stats.audit.byProvider),
    ...renderLatestEvents("Latest events", stats.audit.latestEvents),
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
      "session-id": {
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
    throw new UserInputError("Usage: gbank stats [--project <path>] [--session-id <id>] [--json]");
  }

  const statsService = new StatsService();

  try {
    const projectPath = parsedArgs.values.project;
    const sessionId = parsedArgs.values["session-id"];
    
    const stats = await statsService.collect({
      ...(projectPath ? { projectPath } : {}),
      ...(sessionId ? { sessionId } : {}),
      withProjectsList: !projectPath && !sessionId,
    });

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
