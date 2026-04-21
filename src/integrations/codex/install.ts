import { z } from "zod";

import type { ProviderInstallerContext } from "../../core/providers/types.js";
import type { ProviderInstallResult } from "../../core/providers/types.js";
import { GuidanceBankCliError } from "../../shared/errors.js";
import { createProviderDescriptor, GUIDANCEBANK_SERVER_NAME, LEGACY_GUIDANCEBANK_SERVER_NAMES } from "../shared.js";

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
    parsed.data.transport.env.GUIDANCEBANK_ROOT === context.bankRoot &&
    parsed.data.transport.env.GUIDANCEBANK_PROVIDER_ID === "codex"
  );
};

const isMissingServerMessage = (result: { stdout: string; stderr: string }): boolean =>
  /No .*MCP server found with name:/u.test(`${result.stdout}\n${result.stderr}`);

const buildInstructions = (): string[] => [
  "Configured globally through `codex mcp add` as a user-scoped stdio MCP server.",
];

const cleanupLegacyServers = async (context: ProviderInstallerContext): Promise<void> => {
  for (const legacyServerName of LEGACY_GUIDANCEBANK_SERVER_NAMES) {
    const removeResult = await context.commandRunner({
      command: "codex",
      args: ["mcp", "remove", legacyServerName],
    });

    if (removeResult.exitCode === 0 || isMissingServerMessage(removeResult)) {
      continue;
    }

    throw new GuidanceBankCliError(
      `Failed to remove legacy Codex MCP integration ${legacyServerName}: ${removeResult.stderr || removeResult.stdout || "Unknown error"}`,
    );
  }
};

export const installCodexIntegration = async (context: ProviderInstallerContext): Promise<ProviderInstallResult> => {
  await cleanupLegacyServers(context);

  const getCommand = {
    command: "codex",
    args: ["mcp", "get", GUIDANCEBANK_SERVER_NAME, "--json"],
  };
  const currentServer = await context.commandRunner(getCommand);

  if (currentServer.exitCode === 0 && isExpectedCodexServer(currentServer.stdout, context)) {
    return {
      descriptor: createProviderDescriptor("codex", "Codex", context.mcpServerConfig, buildInstructions()),
      command: getCommand,
      action: "skipped",
    };
  }

  const command = {
    command: "codex",
    args: [
      "mcp",
      "add",
      GUIDANCEBANK_SERVER_NAME,
      "--env",
      `GUIDANCEBANK_ROOT=${context.bankRoot}`,
      "--env",
      "GUIDANCEBANK_PROVIDER_ID=codex",
      "--",
      context.mcpServerConfig.command,
      ...context.mcpServerConfig.args,
    ],
  };
  const result = await context.commandRunner(command);

  if (result.exitCode !== 0) {
    throw new GuidanceBankCliError(`Failed to configure Codex MCP integration: ${result.stderr || result.stdout || "Unknown error"}`);
  }

  return {
    descriptor: createProviderDescriptor("codex", "Codex", context.mcpServerConfig, buildInstructions()),
    command,
    action: "installed",
  };
};
