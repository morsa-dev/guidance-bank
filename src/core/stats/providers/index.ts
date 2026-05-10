import type { TranscriptAnalyzer } from "./types.js";
import { CursorTranscriptAnalyzer } from "./cursorTranscriptAnalyzer.js";
import { CodexTranscriptAnalyzer } from "./codexTranscriptAnalyzer.js";

export type { TranscriptAnalyzer, TranscriptAnalysisResult } from "./types.js";
export { CursorTranscriptAnalyzer } from "./cursorTranscriptAnalyzer.js";
export { CodexTranscriptAnalyzer } from "./codexTranscriptAnalyzer.js";

const providerAnalyzers: Record<string, TranscriptAnalyzer> = {
  cursor: new CursorTranscriptAnalyzer(),
  codex: new CodexTranscriptAnalyzer(),
};

export const getTranscriptAnalyzer = (provider: string): TranscriptAnalyzer | null => {
  return providerAnalyzers[provider] ?? null;
};
