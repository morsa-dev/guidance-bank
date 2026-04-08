import path from "node:path";
import { parseArgs } from "node:util";

import { callLocalMcpTool } from "../callMcpTool.js";

const printUsage = (): void => {
  console.info(`Usage:
  npm run smoke:resolve -- <project-path> [--out <path>] [--bank-root <path>] [--provider <id>]

Default output:
  .smoke/resolve-context.json
`);
};

const main = async (): Promise<void> => {
  const parsed = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      out: { type: "string" },
      "bank-root": { type: "string" },
      provider: { type: "string" },
    },
  });

  if (parsed.values.help) {
    printUsage();
    return;
  }

  const [projectPath] = parsed.positionals;
  if (!projectPath) {
    printUsage();
    throw new Error("Missing project path.");
  }

  const outputPath = parsed.values.out ?? path.join(".smoke", "resolve-context.json");
  const callOptions: {
    toolName: string;
    args: Record<string, unknown>;
    bankRoot?: string;
    provider?: "codex" | "cursor" | "claude-code" | null;
    outputPath: string;
  } = {
    toolName: "resolve_context",
    args: {
      projectPath: path.resolve(projectPath),
      sessionRef: "smoke:resolve-context",
    },
    outputPath,
  };

  if (parsed.values["bank-root"]) {
    callOptions.bankRoot = parsed.values["bank-root"];
  }

  if (parsed.values.provider === "codex" || parsed.values.provider === "cursor" || parsed.values.provider === "claude-code") {
    callOptions.provider = parsed.values.provider;
  } else if (parsed.values.provider !== undefined) {
    throw new Error(`Unsupported provider "${parsed.values.provider}". Expected one of: codex, cursor, claude-code.`);
  }

  await callLocalMcpTool(callOptions);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
