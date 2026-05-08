import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProviderInstallerContext } from "../../core/providers/types.js";
import type { ProviderInstallResult, ProviderUninstallResult } from "../../core/providers/types.js";
import { GuidanceBankCliError } from "../../shared/errors.js";
import { atomicWriteFile } from "../../storage/atomicWrite.js";
import { createProviderDescriptor, GUIDANCEBANK_SERVER_NAME, LEGACY_GUIDANCEBANK_SERVER_NAMES } from "../shared.js";

type CursorMcpServerConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

type CursorMcpConfig = Record<string, unknown> & {
  mcpServers?: Record<string, unknown>;
};

const LEGACY_SERVER_NAME_SET = new Set<string>(LEGACY_GUIDANCEBANK_SERVER_NAMES);

const resolveCursorConfigRoot = (context: ProviderInstallerContext): string =>
  path.resolve(context.cursorConfigRoot ?? path.join(os.homedir(), ".cursor"));

const resolveCursorConfigPath = (context: ProviderInstallerContext): string =>
  path.join(resolveCursorConfigRoot(context), "mcp.json");

const assertSafeCursorConfigPath = async (cursorConfigRoot: string, cursorConfigPath: string): Promise<void> => {
  try {
    const rootStats = await fs.lstat(cursorConfigRoot);
    if (rootStats.isSymbolicLink()) {
      throw new GuidanceBankCliError(`Cursor config root cannot be a symbolic link: ${cursorConfigRoot}`);
    }
    if (!rootStats.isDirectory()) {
      throw new GuidanceBankCliError(`Cursor config root must be a directory: ${cursorConfigRoot}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const fileStats = await fs.lstat(cursorConfigPath);
    if (fileStats.isSymbolicLink()) {
      throw new GuidanceBankCliError(`Cursor MCP config file cannot be a symbolic link: ${cursorConfigPath}`);
    }
    if (!fileStats.isFile()) {
      throw new GuidanceBankCliError(`Cursor MCP config path must be a file: ${cursorConfigPath}`);
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
      throw new GuidanceBankCliError(`Cursor MCP config must be a JSON object: ${cursorConfigPath}`);
    }

    return parsed as CursorMcpConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new GuidanceBankCliError(`Cursor MCP config contains invalid JSON: ${cursorConfigPath}`);
    }
    throw error;
  }
};

const createExpectedServerConfig = (context: ProviderInstallerContext): CursorMcpServerConfig => ({
  command: context.mcpServerConfig.command,
  args: [...context.mcpServerConfig.args],
  env: {
    ...context.mcpServerConfig.env,
    GUIDANCEBANK_PROVIDER_ID: "cursor",
  },
});

const isExpectedCursorServerConfig = (value: unknown, context: ProviderInstallerContext): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<CursorMcpServerConfig>;
  return (
    candidate.command === context.mcpServerConfig.command &&
    Array.isArray(candidate.args) &&
    candidate.args.length === context.mcpServerConfig.args.length &&
    candidate.args.every((arg, index) => arg === context.mcpServerConfig.args[index]) &&
    !!candidate.env &&
    typeof candidate.env === "object" &&
    candidate.env.GUIDANCEBANK_ROOT === context.bankRoot &&
    candidate.env.GUIDANCEBANK_PROVIDER_ID === "cursor"
  );
};

const removeLegacyServerEntries = (mcpServers: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(mcpServers).filter(([serverName]) => !LEGACY_SERVER_NAME_SET.has(serverName)));

export const uninstallCursorIntegration = async (
  context: ProviderInstallerContext,
): Promise<ProviderUninstallResult> => {
  const cursorConfigRoot = resolveCursorConfigRoot(context);
  const cursorConfigPath = resolveCursorConfigPath(context);
  await fs.mkdir(cursorConfigRoot, { recursive: true });
  await assertSafeCursorConfigPath(cursorConfigRoot, cursorConfigPath);

  const currentConfig = await readCursorConfig(cursorConfigPath);
  const currentMcpServers =
    currentConfig.mcpServers && typeof currentConfig.mcpServers === "object" && !Array.isArray(currentConfig.mcpServers)
      ? currentConfig.mcpServers
      : {};

  const nextMcpServers = Object.fromEntries(
    Object.entries(currentMcpServers).filter(
      ([serverName]) => serverName !== GUIDANCEBANK_SERVER_NAME && !LEGACY_SERVER_NAME_SET.has(serverName),
    ),
  );
  const changed = Object.keys(nextMcpServers).length !== Object.keys(currentMcpServers).length;

  if (!changed) {
    return {
      provider: "cursor",
      displayName: "Cursor",
      command: null,
      action: "already_absent",
    };
  }

  const nextConfig: CursorMcpConfig = {
    ...currentConfig,
    mcpServers: nextMcpServers,
  };

  await atomicWriteFile(cursorConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`);

  return {
    provider: "cursor",
    displayName: "Cursor",
    command: null,
    action: "removed",
  };
};

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
  const sanitizedMcpServers = removeLegacyServerEntries(currentMcpServers);
  const currentServer = currentMcpServers[GUIDANCEBANK_SERVER_NAME];
  const legacyServerEntriesRemoved = Object.keys(currentMcpServers).length !== Object.keys(sanitizedMcpServers).length;

  if (isExpectedCursorServerConfig(currentServer, context) && !legacyServerEntriesRemoved) {
    return {
      descriptor: createProviderDescriptor(
        "cursor",
        "Cursor",
        context.mcpServerConfig,
        "config-file",
      ),
      command: null,
      action: "skipped",
    };
  }

  const nextConfig: CursorMcpConfig = {
    ...currentConfig,
    mcpServers: {
      ...sanitizedMcpServers,
      [GUIDANCEBANK_SERVER_NAME]: createExpectedServerConfig(context),
    },
  };

  await atomicWriteFile(cursorConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`);

  return {
    descriptor: createProviderDescriptor(
      "cursor",
      "Cursor",
      context.mcpServerConfig,
      "config-file",
    ),
    command: null,
    action: currentServer === undefined ? "installed" : "reconfigured",
  };
};
