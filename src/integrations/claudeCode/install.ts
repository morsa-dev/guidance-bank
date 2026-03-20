import type { CommandSpec, ProviderInstallResult, ProviderInstallerContext } from "../../core/providers/types.js";
import { MbCliError } from "../../shared/errors.js";
import { createProviderDescriptor, MEMORY_BANK_SERVER_NAME, USER_SCOPE } from "../shared.js";

const buildAddCommand = (bankRoot: string): CommandSpec => ({
  command: "claude",
  args: [
    "mcp",
    "add",
    "--scope",
    USER_SCOPE,
    `--env=MB_BANK_ROOT=${bankRoot}`,
    MEMORY_BANK_SERVER_NAME,
    "--",
    "mb",
    "mcp",
    "serve",
  ],
});

const buildRemoveCommand = (): CommandSpec => ({
  command: "claude",
  args: ["mcp", "remove", "--scope", USER_SCOPE, MEMORY_BANK_SERVER_NAME],
});

const isExpectedClaudeServer = (rawOutput: string, bankRoot: string): boolean =>
  rawOutput.includes("Scope: User config") &&
  rawOutput.includes("Command: mb") &&
  rawOutput.includes("Args: mcp serve") &&
  rawOutput.includes(`MB_BANK_ROOT=${bankRoot}`);

export const installClaudeCodeIntegration = async (
  context: ProviderInstallerContext,
): Promise<ProviderInstallResult> => {
  const getCommand = {
    command: "claude",
    args: ["mcp", "get", MEMORY_BANK_SERVER_NAME],
  };
  const currentServer = await context.commandRunner(getCommand);

  if (currentServer.exitCode === 0 && isExpectedClaudeServer(currentServer.stdout, context.bankRoot)) {
    return {
      descriptor: createProviderDescriptor("claude-code", "Claude Code", context.mcpServerConfig, [
        "Configured globally through `claude mcp add --scope user` as a stdio MCP server.",
      ]),
      command: getCommand,
      action: "skipped",
    };
  }

  const addCommand = buildAddCommand(context.bankRoot);
  let addResult = await context.commandRunner(addCommand);
  let action: ProviderInstallResult["action"] = "installed";

  if (addResult.exitCode !== 0 && `${addResult.stdout}\n${addResult.stderr}`.includes("already exists")) {
    const removeResult = await context.commandRunner(buildRemoveCommand());
    if (removeResult.exitCode !== 0) {
      throw new MbCliError(
        `Failed to reconfigure Claude Code MCP integration: ${removeResult.stderr || removeResult.stdout || "Unknown error"}`,
      );
    }

    addResult = await context.commandRunner(addCommand);
    action = "reconfigured";
  }

  if (addResult.exitCode !== 0) {
    throw new MbCliError(
      `Failed to configure Claude Code MCP integration: ${addResult.stderr || addResult.stdout || "Unknown error"}`,
    );
  }

  return {
    descriptor: createProviderDescriptor("claude-code", "Claude Code", context.mcpServerConfig, [
      "Configured globally through `claude mcp add --scope user` as a stdio MCP server.",
    ]),
    command: addCommand,
    action,
  };
};
