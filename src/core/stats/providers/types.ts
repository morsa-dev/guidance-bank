export type TranscriptAnalysisResult = {
  inputTokens: number;
  outputTokens: number;
  messagesCount: number;
};

export interface TranscriptAnalyzer {
  resolveTranscriptPath(sessionId: string, projectPath: string): Promise<string | null>;
  analyzeTranscript(transcriptPath: string): Promise<TranscriptAnalysisResult>;
}
