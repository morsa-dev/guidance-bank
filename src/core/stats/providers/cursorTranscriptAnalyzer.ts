import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import type { TranscriptAnalyzer, TranscriptAnalysisResult } from "./types.js";

type CursorTranscriptMessage = {
  role: "user" | "assistant";
  message: {
    content: Array<{
      type: string;
      text?: string;
      [key: string]: unknown;
    }>;
  };
};

const estimateTokensFromText = (text: string): number => {
  return Math.ceil(text.length / 3.5);
};

export class CursorTranscriptAnalyzer implements TranscriptAnalyzer {
  async resolveTranscriptPath(sessionId: string, projectPath: string): Promise<string | null> {
    try {
      const normalizedPath = path.resolve(projectPath);
      const projectKey = normalizedPath.replace(/\//g, "-").replace(/^-/, "");
      return path.join(
        os.homedir(),
        ".cursor/projects",
        projectKey,
        "agent-transcripts",
        sessionId,
        `${sessionId}.jsonl`
      );
    } catch {
      return null;
    }
  }

  async analyzeTranscript(transcriptPath: string): Promise<TranscriptAnalysisResult> {
    try {
      const content = await readFile(transcriptPath, "utf8");
      const messages: CursorTranscriptMessage[] = content
        .trim()
        .split("\n")
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line));

      let inputTokens = 0;
      let outputTokens = 0;

      for (const msg of messages) {
        for (const contentItem of msg.message.content) {
          if (contentItem.text) {
            const tokens = estimateTokensFromText(contentItem.text);
            if (msg.role === "user") {
              inputTokens += tokens;
            } else {
              outputTokens += tokens;
            }
          }
        }
      }

      return {
        inputTokens,
        outputTokens,
        messagesCount: messages.length,
      };
    } catch (error) {
      return { inputTokens: 0, outputTokens: 0, messagesCount: 0 };
    }
  }
}
