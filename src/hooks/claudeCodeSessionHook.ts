import { parseArgs } from "node:util";

import { writeClaudeCodeSessionState } from "../mcp/providerSessionState.js";
import { GuidanceBankCliError } from "../shared/errors.js";
import { resolveBankRoot } from "../shared/paths.js";

type ClaudeHookPayload = {
  session_id?: unknown;
  sessionId?: unknown;
  transcript_path?: unknown;
  transcriptPath?: unknown;
  cwd?: unknown;
};

const readStdin = async (): Promise<string> => {
  const chunks: string[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }

  return chunks.join("");
};

const parseClaudeHookPayload = (rawPayload: string): ClaudeHookPayload => {
  try {
    return JSON.parse(rawPayload) as ClaudeHookPayload;
  } catch {
    throw new GuidanceBankCliError("Claude Code hook payload must be valid JSON on stdin.");
  }
};

const resolveSessionId = (payload: ClaudeHookPayload): string | null => {
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : payload.sessionId;
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId.trim() : null;
};

const resolveOptionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

export const runClaudeCodeSessionHook = async (
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> => {
  const parsedArgs = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "bank-root": {
        type: "string",
      },
    },
  });

  const rawPayload = (await readStdin()).trim();
  if (rawPayload.length === 0) {
    throw new GuidanceBankCliError("Claude Code hook payload is required on stdin.");
  }

  const payload = parseClaudeHookPayload(rawPayload);
  const sessionId = resolveSessionId(payload);
  if (sessionId === null) {
    throw new GuidanceBankCliError("Claude Code hook payload must include a non-empty session id.");
  }

  await writeClaudeCodeSessionState(resolveBankRoot(parsedArgs.values["bank-root"]), {
    schemaVersion: 1,
    provider: "claude-code",
    sessionId,
    cwd: resolveOptionalText(payload.cwd),
    transcriptPath: resolveOptionalText(
      typeof payload.transcript_path === "string" ? payload.transcript_path : payload.transcriptPath,
    ),
    capturedAt: new Date().toISOString(),
  });
};

await runClaudeCodeSessionHook();
