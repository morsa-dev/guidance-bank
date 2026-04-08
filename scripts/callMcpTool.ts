import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { createMcpServer } from "../src/mcp/createMcpServer.js";
import type { ProviderId } from "../src/core/bank/types.js";

const TOOLS_REQUIRING_SESSION_REF = new Set([
  "create_bank",
  "improve_bank",
  "resolve_context",
  "upsert_rule",
  "upsert_skill",
  "delete_entry",
  "set_project_state",
  "sync_bank",
  "clear_project_bank",
  "delete_guidance_source",
]);

const printUsage = (): void => {
  console.info(`Usage:
  npm run mcp:call -- <tool-name> [--args <json>] [--args-file <path>] [--out <path>] [--bank-root <path>] [--provider <id>]

Examples:
  npm run mcp:call -- resolve_context --args '{"projectPath":"/abs/project","sessionRef":"smoke:resolve"}'
  npm run mcp:call -- resolve_context --args-file ./tmp/resolve.args.json --out ./tmp/resolve.result.json
`);
};

const parseJsonObject = (value: string, sourceLabel: string): Record<string, unknown> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Invalid JSON in ${sourceLabel}: ${message}`, { cause: error });
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${sourceLabel} must contain a JSON object.`);
  }

  return parsed as Record<string, unknown>;
};

const readArgsObject = async (options: {
  argsText: string | undefined;
  argsFile: string | undefined;
}): Promise<Record<string, unknown>> => {
  if (options.argsText && options.argsFile) {
    throw new Error("Use either --args or --args-file, not both.");
  }

  if (options.argsText) {
    return parseJsonObject(options.argsText, "--args");
  }

  if (options.argsFile) {
    const { readFile } = await import("node:fs/promises");
    const fileContents = await readFile(options.argsFile, "utf8");
    return parseJsonObject(fileContents, options.argsFile);
  }

  return {};
};

const withSessionRef = (toolName: string, args: Record<string, unknown>): Record<string, unknown> => {
  if (!TOOLS_REQUIRING_SESSION_REF.has(toolName)) {
    return args;
  }

  const existing = args.sessionRef;
  if (typeof existing === "string" && existing.trim().length > 0) {
    return args;
  }

  return {
    ...args,
    sessionRef: `smoke:${toolName}:${new Date().toISOString()}`,
  };
};

const normalizeProvider = (value: string | undefined): ProviderId | null => {
  if (!value) {
    return null;
  }

  if (value === "codex" || value === "cursor" || value === "claude-code") {
    return value;
  }

  throw new Error(`Unsupported provider "${value}". Expected one of: codex, cursor, claude-code.`);
};

export const callLocalMcpTool = async ({
  toolName,
  args,
  bankRoot,
  provider,
  outputPath,
}: {
  toolName: string;
  args: Record<string, unknown>;
  bankRoot?: string;
  provider?: ProviderId | null;
  outputPath?: string;
}): Promise<{
  tool: string;
  arguments: Record<string, unknown>;
  result: ReturnType<typeof CallToolResultSchema.parse>;
}> => {
  const serverOptions: {
    bankRoot?: string;
    provider?: ProviderId | null;
  } = {};

  if (bankRoot) {
    serverOptions.bankRoot = bankRoot;
  }

  if (provider !== null && provider !== undefined) {
    serverOptions.provider = provider;
  }

  const normalizedArgs = withSessionRef(toolName, args);
  const server = createMcpServer(serverOptions);
  const client = new Client({
    name: "memory-bank-local-smoke-client",
    version: "0.0.0",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = CallToolResultSchema.parse(await client.callTool({ name: toolName, arguments: normalizedArgs }));
    const payload = {
      tool: toolName,
      arguments: normalizedArgs,
      result,
    };
    const serialized = JSON.stringify(payload, null, 2);

    if (outputPath) {
      const resolvedOutputPath = path.resolve(outputPath);
      await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
      await writeFile(resolvedOutputPath, `${serialized}\n`);
      console.info(`Wrote MCP response to ${resolvedOutputPath}`);
    } else {
      console.info(serialized);
    }

    return payload;
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
};

const main = async (): Promise<void> => {
  const parsed = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      args: { type: "string" },
      "args-file": { type: "string" },
      out: { type: "string" },
      "bank-root": { type: "string" },
      provider: { type: "string" },
    },
  });

  if (parsed.values.help) {
    printUsage();
    return;
  }

  const [toolName] = parsed.positionals;
  if (!toolName) {
    printUsage();
    throw new Error("Missing MCP tool name.");
  }

  const args = await readArgsObject({
    argsText: parsed.values.args,
    argsFile: parsed.values["args-file"],
  });

  const callOptions: {
    toolName: string;
    args: Record<string, unknown>;
    bankRoot?: string;
    provider?: ProviderId | null;
    outputPath?: string;
  } = {
    toolName,
    args,
  };

  if (parsed.values["bank-root"]) {
    callOptions.bankRoot = parsed.values["bank-root"];
  }

  const provider = normalizeProvider(parsed.values.provider);
  if (provider !== null) {
    callOptions.provider = provider;
  }

  if (parsed.values.out) {
    callOptions.outputPath = parsed.values.out;
  }

  await callLocalMcpTool(callOptions);
};

const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message);
    process.exitCode = 1;
  });
}
