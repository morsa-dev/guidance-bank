import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { McpServerConfig } from "../core/bank/types.js";
import { atomicWriteFile } from "../storage/atomicWrite.js";

const MCP_LAUNCHER_BASENAME = "guidancebank-mcp";
const CLAUDE_CODE_SESSION_HOOK_LAUNCHER_BASENAME = "guidancebank-claude-code-hook";

type LaunchConfigOptions = {
  platform?: NodeJS.Platform;
  comSpec?: string;
  systemRoot?: string;
};

const resolveCliEntrypointPath = (): string =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "gbank.js");

const resolveClaudeCodeSessionHookEntrypointPath = (): string =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "gbank-claude-code-hook.js");

const getPathModule = (platform: NodeJS.Platform): typeof path.posix | typeof path.win32 =>
  platform === "win32" ? path.win32 : path.posix;

const quotePosixShellLiteral = (value: string): string => `'${value.replaceAll("'", `'\"'\"'`)}'`;

const quoteWindowsBatchLiteral = (value: string): string => `"${value.replaceAll("%", "%%")}"`;

const quoteWindowsCommandArgument = (value: string): string => `"${value.replaceAll('"', '""').replaceAll("%", "%%")}"`;

const resolveWindowsCommandPath = (options: LaunchConfigOptions): string => {
  if (options.comSpec && options.comSpec.trim().length > 0) {
    return options.comSpec;
  }

  const systemRoot = options.systemRoot && options.systemRoot.trim().length > 0 ? options.systemRoot : "C:\\Windows";
  return path.win32.join(systemRoot, "System32", "cmd.exe");
};

export const resolveMcpLauncherPath = (bankRoot: string, platform: NodeJS.Platform = process.platform): string => {
  const pathModule = getPathModule(platform);
  return pathModule.join(bankRoot, "bin", platform === "win32" ? `${MCP_LAUNCHER_BASENAME}.cmd` : MCP_LAUNCHER_BASENAME);
};

export const resolveClaudeCodeSessionHookLauncherPath = (
  bankRoot: string,
  platform: NodeJS.Platform = process.platform,
): string => {
  const pathModule = getPathModule(platform);
  return pathModule.join(
    bankRoot,
    "bin",
    platform === "win32"
      ? `${CLAUDE_CODE_SESSION_HOOK_LAUNCHER_BASENAME}.cmd`
      : CLAUDE_CODE_SESSION_HOOK_LAUNCHER_BASENAME,
  );
};

export const createDefaultMcpLaunchConfig = (
  bankRoot: string,
  options: LaunchConfigOptions = {},
): Pick<McpServerConfig, "command" | "args"> => {
  const platform = options.platform ?? process.platform;
  const launcherPath = resolveMcpLauncherPath(bankRoot, platform);

  if (platform === "win32") {
    return {
      command: resolveWindowsCommandPath(options),
      args: ["/d", "/s", "/c", quoteWindowsCommandArgument(launcherPath)],
    };
  }

  return {
    command: launcherPath,
    args: [],
  };
};

export const createMcpLauncherContent = (platform: NodeJS.Platform = process.platform): string => {
  if (platform === "win32") {
    return `@echo off\r\n${quoteWindowsBatchLiteral(process.execPath)} ${quoteWindowsBatchLiteral(resolveCliEntrypointPath())} mcp serve %*\r\n`;
  }

  return `#!/bin/sh\nexec ${quotePosixShellLiteral(process.execPath)} ${quotePosixShellLiteral(resolveCliEntrypointPath())} mcp serve "$@"\n`;
};

export const createClaudeCodeSessionHookLauncherContent = (
  bankRoot: string,
  platform: NodeJS.Platform = process.platform,
): string => {
  if (platform === "win32") {
    return `@echo off\r\n${quoteWindowsBatchLiteral(process.execPath)} ${quoteWindowsBatchLiteral(resolveClaudeCodeSessionHookEntrypointPath())} --bank-root ${quoteWindowsBatchLiteral(bankRoot)} %*\r\n`;
  }

  return `#!/bin/sh\nexec ${quotePosixShellLiteral(process.execPath)} ${quotePosixShellLiteral(resolveClaudeCodeSessionHookEntrypointPath())} --bank-root ${quotePosixShellLiteral(bankRoot)} "$@"\n`;
};

export const ensureMcpLauncher = async (bankRoot: string, platform: NodeJS.Platform = process.platform): Promise<void> => {
  const launcherPath = resolveMcpLauncherPath(bankRoot, platform);
  await fs.mkdir(path.dirname(launcherPath), { recursive: true });
  await atomicWriteFile(launcherPath, createMcpLauncherContent(platform));

  if (platform !== "win32") {
    await fs.chmod(launcherPath, 0o755);
  }
};

export const ensureClaudeCodeSessionHookLauncher = async (
  bankRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> => {
  const launcherPath = resolveClaudeCodeSessionHookLauncherPath(bankRoot, platform);
  await fs.mkdir(path.dirname(launcherPath), { recursive: true });
  await atomicWriteFile(launcherPath, createClaudeCodeSessionHookLauncherContent(bankRoot, platform));

  if (platform !== "win32") {
    await fs.chmod(launcherPath, 0o755);
  }
};

export const removeClaudeCodeSessionHookLauncher = async (
  bankRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> => {
  const launcherPath = resolveClaudeCodeSessionHookLauncherPath(bankRoot, platform);

  try {
    await fs.rm(launcherPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
};

export const ensureGuidanceBankLaunchers = async (
  bankRoot: string,
  options: { includeClaudeCodeHook?: boolean } = {},
  platform: NodeJS.Platform = process.platform,
): Promise<void> => {
  await ensureMcpLauncher(bankRoot, platform);

  if (options.includeClaudeCodeHook === true) {
    await ensureClaudeCodeSessionHookLauncher(bankRoot, platform);
    return;
  }

  await removeClaudeCodeSessionHookLauncher(bankRoot, platform);
};
