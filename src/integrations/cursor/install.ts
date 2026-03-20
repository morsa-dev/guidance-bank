import type { ProviderInstallerContext } from "../../core/providers/types.js";
import type { ProviderInstallResult } from "../../core/providers/types.js";
import { MbCliError } from "../../shared/errors.js";
import { createProviderDescriptor, MEMORY_BANK_SERVER_NAME } from "../shared.js";

const encodeCursorPayload = (bankRoot: string): string => {
  const rawPayload = JSON.stringify({
    name: MEMORY_BANK_SERVER_NAME,
    command: "mb",
    args: ["mcp", "serve"],
    env: {
      MB_BANK_ROOT: bankRoot.replaceAll("'", "\\u0027"),
    },
  });

  return `'${rawPayload}'`;
};

export const installCursorIntegration = async (context: ProviderInstallerContext): Promise<ProviderInstallResult> => {
  if (context.existingDescriptor?.serverName === MEMORY_BANK_SERVER_NAME) {
    const existingConfig = context.existingDescriptor.mcpServer;
    const matchesExistingConfig =
      existingConfig.command === "mb" &&
      existingConfig.args.length === 2 &&
      existingConfig.args[0] === "mcp" &&
      existingConfig.args[1] === "serve" &&
      existingConfig.env.MB_BANK_ROOT === context.bankRoot;

    if (matchesExistingConfig) {
      return {
        descriptor: createProviderDescriptor("cursor", "Cursor", context.mcpServerConfig, [
          "Configured globally through `cursor --add-mcp` in the user profile.",
        ]),
        command: {
          command: "cursor",
          args: ["--add-mcp", encodeCursorPayload(context.bankRoot)],
        },
        action: "skipped",
      };
    }
  }

  const command = {
    command: "cursor",
    args: ["--add-mcp", encodeCursorPayload(context.bankRoot)],
  };
  const result = await context.commandRunner(command);

  if (result.exitCode !== 0) {
    throw new MbCliError(`Failed to configure Cursor MCP integration: ${result.stderr || result.stdout || "Unknown error"}`);
  }

  return {
    descriptor: createProviderDescriptor("cursor", "Cursor", context.mcpServerConfig, [
      "Configured globally through `cursor --add-mcp` in the user profile.",
    ]),
    command,
    action: "installed",
  };
};
