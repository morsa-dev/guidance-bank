import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProviderInstallerContext } from "../../core/providers/types.js";
import type { ProviderInstallResult } from "../../core/providers/types.js";
import { MbCliError } from "../../shared/errors.js";
import { atomicWriteFile } from "../../storage/atomicWrite.js";
import { createProviderDescriptor, MEMORY_BANK_SERVER_NAME } from "../shared.js";

type CursorMcpServerConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

type CursorMcpConfig = Record<string, unknown> & {
  mcpServers?: Record<string, unknown>;
};

const resolveCursorConfigRoot = (context: ProviderInstallerContext): string =>
  path.resolve(context.cursorConfigRoot ?? path.join(os.homedir(), ".cursor"));

const resolveCursorConfigPath = (context: ProviderInstallerContext): string =>
  path.join(resolveCursorConfigRoot(context), "mcp.json");

const assertSafeCursorConfigPath = async (cursorConfigRoot: string, cursorConfigPath: string): Promise<void> => {
  try {
    const rootStats = await fs.lstat(cursorConfigRoot);
    if (rootStats.isSymbolicLink()) {
      throw new MbCliError(`Cursor config root cannot be a symbolic link: ${cursorConfigRoot}`);
    }
    if (!rootStats.isDirectory()) {
      throw new MbCliError(`Cursor config root must be a directory: ${cursorConfigRoot}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const fileStats = await fs.lstat(cursorConfigPath);
    if (fileStats.isSymbolicLink()) {
      throw new MbCliError(`Cursor MCP config file cannot be a symbolic link: ${cursorConfigPath}`);
    }
    if (!fileStats.isFile()) {
      throw new MbCliError(`Cursor MCP config path must be a file: ${cursorConfigPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
};

const readCursorConfig = async (cursorConfigPath: string): Promise<CursorMcpConfig> => {
  try {
    const rawContent = await fs.readFile(cursorConfigPath, "utf8");
    const parsed = JSON.parse(rawContent) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new MbCliError(`Cursor MCP config must be a JSON object: ${cursorConfigPath}`);
    }

    return parsed as CursorMcpConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new MbCliError(`Cursor MCP config contains invalid JSON: ${cursorConfigPath}`);
    }
    throw error;
  }
};

const createExpectedServerConfig = (bankRoot: string): CursorMcpServerConfig => ({
  command: "mb",
  args: ["mcp", "serve"],
  env: {
    MB_BANK_ROOT: bankRoot,
    MB_PROVIDER_ID: "cursor",
  },
});

const isExpectedCursorServerConfig = (value: unknown, bankRoot: string): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<CursorMcpServerConfig>;
  return (
    candidate.command === "mb" &&
    Array.isArray(candidate.args) &&
    candidate.args.length === 2 &&
    candidate.args[0] === "mcp" &&
    candidate.args[1] === "serve" &&
    !!candidate.env &&
    typeof candidate.env === "object" &&
    candidate.env.MB_BANK_ROOT === bankRoot &&
    candidate.env.MB_PROVIDER_ID === "cursor"
  );
};

const buildInstructions = (cursorConfigPath: string): string[] => [
  `Configured by writing the user-level Cursor MCP config at ${cursorConfigPath}.`,
  "If Cursor is already running, reload the window or restart Cursor if the new MCP server does not appear immediately.",
];

export const installCursorIntegration = async (context: ProviderInstallerContext): Promise<ProviderInstallResult> => {
  const cursorConfigRoot = resolveCursorConfigRoot(context);
  const cursorConfigPath = resolveCursorConfigPath(context);
  await fs.mkdir(cursorConfigRoot, { recursive: true });
  await assertSafeCursorConfigPath(cursorConfigRoot, cursorConfigPath);

  const currentConfig = await readCursorConfig(cursorConfigPath);
  const currentMcpServers =
    currentConfig.mcpServers && typeof currentConfig.mcpServers === "object" && !Array.isArray(currentConfig.mcpServers)
      ? currentConfig.mcpServers
      : {};
  const currentServer = currentMcpServers[MEMORY_BANK_SERVER_NAME];

  if (isExpectedCursorServerConfig(currentServer, context.bankRoot)) {
    return {
      descriptor: createProviderDescriptor(
        "cursor",
        "Cursor",
        context.mcpServerConfig,
        buildInstructions(cursorConfigPath),
        "config-file",
      ),
      command: null,
      action: "skipped",
    };
  }

  const nextConfig: CursorMcpConfig = {
    ...currentConfig,
    mcpServers: {
      ...currentMcpServers,
      [MEMORY_BANK_SERVER_NAME]: createExpectedServerConfig(context.bankRoot),
    },
  };

  await atomicWriteFile(cursorConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`);

  return {
    descriptor: createProviderDescriptor(
      "cursor",
      "Cursor",
      context.mcpServerConfig,
      buildInstructions(cursorConfigPath),
      "config-file",
    ),
    command: null,
    action: currentServer === undefined ? "installed" : "reconfigured",
  };
};
