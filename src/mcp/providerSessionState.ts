import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { atomicWriteFile } from "../storage/atomicWrite.js";

export type ClaudeCodeSessionState = {
  schemaVersion: 1;
  provider: "claude-code";
  sessionId: string;
  cwd: string | null;
  transcriptPath: string | null;
  capturedAt: string;
};

const CLAUDE_CODE_SESSION_STATE_RELATIVE_PATH = path.join(
  "runtime",
  "provider-sessions",
  "claude-code.json",
);

export const resolveClaudeCodeSessionStatePath = (bankRoot: string): string =>
  path.join(bankRoot, CLAUDE_CODE_SESSION_STATE_RELATIVE_PATH);

export const readClaudeCodeSessionState = async (
  bankRoot: string,
): Promise<ClaudeCodeSessionState | null> => {
  const statePath = resolveClaudeCodeSessionStatePath(bankRoot);

  try {
    const rawContent = await readFile(statePath, "utf8");
    const parsed = JSON.parse(rawContent) as Partial<ClaudeCodeSessionState>;

    if (
      parsed?.schemaVersion !== 1 ||
      parsed.provider !== "claude-code" ||
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.trim().length === 0 ||
      typeof parsed.capturedAt !== "string"
    ) {
      return null;
    }

    return {
      schemaVersion: 1,
      provider: "claude-code",
      sessionId: parsed.sessionId,
      cwd: typeof parsed.cwd === "string" && parsed.cwd.trim().length > 0 ? parsed.cwd : null,
      transcriptPath:
        typeof parsed.transcriptPath === "string" && parsed.transcriptPath.trim().length > 0
          ? parsed.transcriptPath
          : null,
      capturedAt: parsed.capturedAt,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

export const writeClaudeCodeSessionState = async (
  bankRoot: string,
  state: ClaudeCodeSessionState,
): Promise<void> => {
  const statePath = resolveClaudeCodeSessionStatePath(bankRoot);
  await mkdir(path.dirname(statePath), { recursive: true });
  await atomicWriteFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
};
