import { access } from "node:fs/promises";

import type { AuditEvent, ToolAuditEvent } from "../audit/types.js";
import { getTranscriptAnalyzer } from "./providers/index.js";

export type SessionTokenStats = {
  sessionId: string;
  provider: string;
  projectPath: string;
  startTime: string | null;
  endTime: string | null;
  
  // Total tokens from transcript
  totalTokens: {
    input: number;
    output: number;
    total: number;
  };
  
  // Bank-specific tokens
  bankTokens: {
    contextTokens: number;
    toolCalls: number;
    overhead: number;
  };
  
  // Analysis
  bankOverheadPercent: number;
  messagesCount: number;
  transcriptPath: string | null;
  transcriptExists: boolean;
};

export type ProjectTokenStats = {
  projectId: string;
  projectPath: string;
  sessions: SessionTokenStats[];
  
  totalTokens: {
    input: number;
    output: number;
    total: number;
  };
  
  bankTokens: {
    contextTokens: number;
    totalToolCalls: number;
    overhead: number;
  };
  
  bankOverheadPercent: number;
};

const resolveTranscriptPath = async (
  sessionId: string,
  provider: string,
  projectPath: string
): Promise<string | null> => {
  const analyzer = getTranscriptAnalyzer(provider);
  if (!analyzer) {
    return null;
  }
  return await analyzer.resolveTranscriptPath(sessionId, projectPath);
};

const analyzeTranscript = async (
  transcriptPath: string,
  provider: string
): Promise<{ inputTokens: number; outputTokens: number; messagesCount: number }> => {
  try {
    await access(transcriptPath);
    
    const analyzer = getTranscriptAnalyzer(provider);
    if (!analyzer) {
      return { inputTokens: 0, outputTokens: 0, messagesCount: 0 };
    }
    
    return await analyzer.analyzeTranscript(transcriptPath);
  } catch {
    return { inputTokens: 0, outputTokens: 0, messagesCount: 0 };
  }
};

const calculateBankMetrics = (events: ToolAuditEvent[]): { contextTokens: number; toolCalls: number } => {
  let contextTokens = 0;
  let toolCalls = 0;

  for (const event of events) {
    if (event.metrics?.estimatedTokens) {
      contextTokens += event.metrics.estimatedTokens;
    }
    toolCalls++;
  }

  return { contextTokens, toolCalls };
};

export class TokenStatsService {
  async analyzeSession(
    sessionId: string,
    provider: string,
    projectPath: string,
    events: AuditEvent[],
  ): Promise<SessionTokenStats> {
    const sessionEvents = events.filter(
      e => e.providerSessionId === sessionId
    ) as ToolAuditEvent[];

    const timestamps = sessionEvents.map(e => e.timestamp).sort();
    const startTime = timestamps[0] ?? null;
    const endTime = timestamps[timestamps.length - 1] ?? null;

    const transcriptPath = await resolveTranscriptPath(sessionId, provider, projectPath);
    let totalTokens = { input: 0, output: 0, total: 0 };
    let messagesCount = 0;
    let transcriptExists = false;

    if (transcriptPath) {
      const transcriptStats = await analyzeTranscript(transcriptPath, provider);
      transcriptExists = transcriptStats.messagesCount > 0;
      totalTokens = {
        input: transcriptStats.inputTokens,
        output: transcriptStats.outputTokens,
        total: transcriptStats.inputTokens + transcriptStats.outputTokens,
      };
      messagesCount = transcriptStats.messagesCount;
    }

    const bankMetrics = calculateBankMetrics(sessionEvents);
    const bankOverhead = Math.min(bankMetrics.contextTokens, totalTokens.total);
    const bankOverheadPercent = totalTokens.total > 0
      ? (bankOverhead / totalTokens.total) * 100
      : 0;

    return {
      sessionId,
      provider,
      projectPath,
      startTime,
      endTime,
      totalTokens,
      bankTokens: {
        contextTokens: bankMetrics.contextTokens,
        toolCalls: bankMetrics.toolCalls,
        overhead: bankOverhead,
      },
      bankOverheadPercent,
      messagesCount,
      transcriptPath,
      transcriptExists,
    };
  }

  async analyzeProject(
    projectId: string,
    projectPath: string,
    events: AuditEvent[],
  ): Promise<ProjectTokenStats> {
    const projectEvents = events.filter(e => e.projectId === projectId);
    
    const sessionIds = new Set<string>();
    const sessionProviders = new Map<string, string>();
    
    for (const event of projectEvents) {
      if (event.providerSessionId) {
        sessionIds.add(event.providerSessionId);
        if (!sessionProviders.has(event.providerSessionId)) {
          sessionProviders.set(event.providerSessionId, event.provider ?? "unknown");
        }
      }
    }

    const sessions: SessionTokenStats[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalContextTokens = 0;
    let totalToolCalls = 0;

    for (const sessionId of sessionIds) {
      const provider = sessionProviders.get(sessionId) ?? "unknown";
      const sessionStats = await this.analyzeSession(sessionId, provider, projectPath, events);
      sessions.push(sessionStats);
      
      totalInput += sessionStats.totalTokens.input;
      totalOutput += sessionStats.totalTokens.output;
      totalContextTokens += sessionStats.bankTokens.contextTokens;
      totalToolCalls += sessionStats.bankTokens.toolCalls;
    }

    const totalTokensSum = totalInput + totalOutput;
    const totalBankOverhead = Math.min(totalContextTokens, totalTokensSum);

    return {
      projectId,
      projectPath,
      sessions: sessions.sort((a, b) => (b.endTime ?? "").localeCompare(a.endTime ?? "")),
      totalTokens: {
        input: totalInput,
        output: totalOutput,
        total: totalTokensSum,
      },
      bankTokens: {
        contextTokens: totalContextTokens,
        totalToolCalls,
        overhead: totalBankOverhead,
      },
      bankOverheadPercent: totalTokensSum > 0 ? (totalBankOverhead / totalTokensSum) * 100 : 0,
    };
  }
}
