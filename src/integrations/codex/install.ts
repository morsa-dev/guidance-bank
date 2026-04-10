import { z } from "zod";

import type { ProviderInstallerContext } from "../../core/providers/types.js";
import type { ProviderInstallResult } from "../../core/providers/types.js";
import { MbCliError } from "../../shared/errors.js";
import { createProviderDescriptor, MEMORY_BANK_SERVER_NAME } from "../shared.js";

const CodexServerSchema = z
  .object({
    transport: z.object({
      type: z.literal("stdio"),
      command: z.string(),
      args: z.array(z.string()),
      env: z.record(z.string(), z.string()),
    }),
  })
  .strict();

const isExpectedCodexServer = (rawOutput: string, context: ProviderInstallerContext): boolean => {
  const parsed = CodexServerSchema.safeParse(JSON.parse(rawOutput) as unknown);
  if (!parsed.success) {
    return false;
  }

  return (
    parsed.data.transport.command === context.mcpServerConfig.command &&
    parsed.data.transport.args.length === context.mcpServerConfig.args.length &&
    parsed.data.transport.args.every((arg, index) => arg === context.mcpServerConfig.args[index]) &&
    parsed.data.transport.env.MB_BANK_ROOT === context.bankRoot &&
    parsed.data.transport.env.MB_PROVIDER_ID === "codex"
  );
};

export const installCodexIntegration = async (context: ProviderInstallerContext): Promise<ProviderInstallResult> => {
  const getCommand = {
    command: "codex",
    args: ["mcp", "get", MEMORY_BANK_SERVER_NAME, "--json"],
  };
  const currentServer = await context.commandRunner(getCommand);

  if (currentServer.exitCode === 0 && isExpectedCodexServer(currentServer.stdout, context)) {
    return {
      descriptor: createProviderDescriptor("codex", "Codex", context.mcpServerConfig, [
        "Configured globally through `codex mcp add` as a user-scoped stdio MCP server.",
      ]),
      command: getCommand,
      action: "skipped",
    };
  }

  const command = {
    command: "codex",
    args: [
      "mcp",
      "add",
      MEMORY_BANK_SERVER_NAME,
      "--env",
      `MB_BANK_ROOT=${context.bankRoot}`,
      "--env",
      "MB_PROVIDER_ID=codex",
      "--",
      context.mcpServerConfig.command,
      ...context.mcpServerConfig.args,
    ],
  };
  const result = await context.commandRunner(command);

  if (result.exitCode !== 0) {
    throw new MbCliError(`Failed to configure Codex MCP integration: ${result.stderr || result.stdout || "Unknown error"}`);
  }

  return {
    descriptor: createProviderDescriptor("codex", "Codex", context.mcpServerConfig, [
      "Configured globally through `codex mcp add` as a user-scoped stdio MCP server.",
    ]),
    command,
    action: "installed",
  };
};
