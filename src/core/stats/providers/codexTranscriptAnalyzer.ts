import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

import type { TranscriptAnalyzer, TranscriptAnalysisResult } from "./types.js";

type CodexTranscriptEvent = {
  type: string;
  timestamp: string;
  payload: {
    role?: string;
    type?: string;
    content?: Array<{
      type: string;
      text?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
};

const estimateTokensFromText = (text: string): number => {
  return Math.ceil(text.length / 3.5);
};

export class CodexTranscriptAnalyzer implements TranscriptAnalyzer {
  async resolveTranscriptPath(sessionId: string, _projectPath: string): Promise<string | null> {
    try {
      const codexDir = path.join(os.homedir(), ".codex/sessions");
      
      // Format: ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session_id>.jsonl
      const searchPattern = `*${sessionId}.jsonl`;
      const findCommand = `find "${codexDir}" -name "${searchPattern}" -type f 2>/dev/null | head -1`;
      
      const result = execSync(findCommand, { encoding: "utf8" }).trim();
      return result || null;
    } catch {
      return null;
    }
  }

  async analyzeTranscript(transcriptPath: string): Promise<TranscriptAnalysisResult> {
    try {
      const content = await readFile(transcriptPath, "utf8");
      const events: CodexTranscriptEvent[] = content
        .trim()
        .split("\n")
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line));

      let inputTokens = 0;
      let outputTokens = 0;
      let messagesCount = 0;

      for (const event of events) {
        if (event.type === "response_item" && event.payload.type === "message" && event.payload.content) {
          messagesCount++;
          for (const contentItem of event.payload.content) {
            if (contentItem.text) {
              const tokens = estimateTokensFromText(contentItem.text);
              // Codex uses "user" and "developer" (assistant)
              if (event.payload.role === "user") {
                inputTokens += tokens;
              } else if (event.payload.role === "developer") {
                outputTokens += tokens;
              }
            }
          }
        }
      }

      return {
        inputTokens,
        outputTokens,
        messagesCount,
      };
    } catch (error) {
      return { inputTokens: 0, outputTokens: 0, messagesCount: 0 };
    }
  }
}
