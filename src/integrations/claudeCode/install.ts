import type { CommandSpec, ProviderInstallResult, ProviderInstallerContext } from "../../core/providers/types.js";
import { GuidanceBankCliError } from "../../shared/errors.js";
import { createProviderDescriptor, GUIDANCEBANK_SERVER_NAME, USER_SCOPE } from "../shared.js";

const buildAddCommand = (context: ProviderInstallerContext): CommandSpec => ({
  command: "claude",
  args: [
    "mcp",
    "add",
    "--scope",
    USER_SCOPE,
    `--env=GUIDANCEBANK_ROOT=${context.bankRoot}`,
    "--env=GUIDANCEBANK_PROVIDER_ID=claude-code",
    GUIDANCEBANK_SERVER_NAME,
    "--",
    context.mcpServerConfig.command,
    ...context.mcpServerConfig.args,
  ],
});

const buildRemoveCommand = (): CommandSpec => ({
  command: "claude",
  args: ["mcp", "remove", "--scope", USER_SCOPE, GUIDANCEBANK_SERVER_NAME],
});

const isExpectedClaudeServer = (rawOutput: string, context: ProviderInstallerContext): boolean =>
  rawOutput.includes("Scope: User config") &&
  rawOutput.includes(`Command: ${context.mcpServerConfig.command}`) &&
  rawOutput.includes(`Args: ${context.mcpServerConfig.args.join(" ")}`) &&
  rawOutput.includes(`GUIDANCEBANK_ROOT=${context.bankRoot}`) &&
  rawOutput.includes("GUIDANCEBANK_PROVIDER_ID=claude-code");

export const installClaudeCodeIntegration = async (
  context: ProviderInstallerContext,
): Promise<ProviderInstallResult> => {
  const getCommand = {
    command: "claude",
    args: ["mcp", "get", GUIDANCEBANK_SERVER_NAME],
  };
  const currentServer = await context.commandRunner(getCommand);

  if (currentServer.exitCode === 0 && isExpectedClaudeServer(currentServer.stdout, context)) {
    return {
      descriptor: createProviderDescriptor("claude-code", "Claude Code", context.mcpServerConfig, [
        "Configured globally through `claude mcp add --scope user` as a stdio MCP server.",
      ]),
      command: getCommand,
      action: "skipped",
    };
  }

  const addCommand = buildAddCommand(context);
  let addResult = await context.commandRunner(addCommand);
  let action: ProviderInstallResult["action"] = "installed";

  if (addResult.exitCode !== 0 && `${addResult.stdout}\n${addResult.stderr}`.includes("already exists")) {
    const removeResult = await context.commandRunner(buildRemoveCommand());
    if (removeResult.exitCode !== 0) {
      throw new GuidanceBankCliError(
        `Failed to reconfigure Claude Code MCP integration: ${removeResult.stderr || removeResult.stdout || "Unknown error"}`,
      );
    }

    addResult = await context.commandRunner(addCommand);
    action = "reconfigured";
  }

  if (addResult.exitCode !== 0) {
    throw new GuidanceBankCliError(
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
