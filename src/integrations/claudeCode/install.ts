import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  CommandSpec,
  ProviderInstallResult,
  ProviderInstallerContext,
  ProviderUninstallResult,
} from "../../core/providers/types.js";
import { resolveClaudeCodeSessionHookLauncherPath } from "../../mcp/launcher.js";
import { GuidanceBankCliError } from "../../shared/errors.js";
import { atomicWriteFile } from "../../storage/atomicWrite.js";
import { createProviderDescriptor, GUIDANCEBANK_SERVER_NAME, LEGACY_GUIDANCEBANK_SERVER_NAMES, USER_SCOPE } from "../shared.js";

type ClaudeSettings = Record<string, unknown> & {
  hooks?: Record<string, unknown>;
};

type ClaudeHookGroup = {
  matcher?: unknown;
  hooks?: unknown;
};

const CLAUDE_HOOK_EVENT_NAME = "PreToolUse";
const CLAUDE_HOOK_MATCHER = `mcp__${GUIDANCEBANK_SERVER_NAME}__.*`;

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

const buildRemoveLegacyCommand = (legacyServerName: string): CommandSpec => ({
  command: "claude",
  args: ["mcp", "remove", "--scope", USER_SCOPE, legacyServerName],
});

const resolveClaudeSettingsRoot = (context: ProviderInstallerContext): string =>
  path.resolve(context.claudeConfigRoot ?? path.join(os.homedir(), ".claude"));

const resolveClaudeSettingsPath = (context: ProviderInstallerContext): string =>
  path.join(resolveClaudeSettingsRoot(context), "settings.json");

const quoteShellLiteral = (value: string): string => `'${value.replaceAll("'", `'\"'\"'`)}'`;

const createClaudeHookCommand = (context: ProviderInstallerContext): string =>
  `${quoteShellLiteral(resolveClaudeCodeSessionHookLauncherPath(context.bankRoot))}`;

const assertSafeClaudeSettingsPath = async (claudeConfigRoot: string, claudeSettingsPath: string): Promise<void> => {
  try {
    const rootStats = await fs.lstat(claudeConfigRoot);
    if (rootStats.isSymbolicLink()) {
      throw new GuidanceBankCliError(`Claude config root cannot be a symbolic link: ${claudeConfigRoot}`);
    }
    if (!rootStats.isDirectory()) {
      throw new GuidanceBankCliError(`Claude config root must be a directory: ${claudeConfigRoot}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const fileStats = await fs.lstat(claudeSettingsPath);
    if (fileStats.isSymbolicLink()) {
      throw new GuidanceBankCliError(`Claude settings file cannot be a symbolic link: ${claudeSettingsPath}`);
    }
    if (!fileStats.isFile()) {
      throw new GuidanceBankCliError(`Claude settings path must be a file: ${claudeSettingsPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
};

const readClaudeSettings = async (claudeSettingsPath: string): Promise<ClaudeSettings> => {
  try {
    const rawContent = await fs.readFile(claudeSettingsPath, "utf8");
    const parsed = JSON.parse(rawContent) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new GuidanceBankCliError(`Claude settings must be a JSON object: ${claudeSettingsPath}`);
    }

    return parsed as ClaudeSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new GuidanceBankCliError(`Claude settings contain invalid JSON: ${claudeSettingsPath}`);
    }
    throw error;
  }
};

const normalizeHookGroups = (value: unknown): ClaudeHookGroup[] =>
  Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") as ClaudeHookGroup[] : [];

const normalizeHookHandlers = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>> : [];

const isGuidanceBankClaudeHookGroup = (group: ClaudeHookGroup, command: string): boolean =>
  group.matcher === CLAUDE_HOOK_MATCHER &&
  normalizeHookHandlers(group.hooks).some(
    (hook) => hook.type === "command" && hook.command === command,
  );

const upsertClaudeHookSettings = async (context: ProviderInstallerContext): Promise<void> => {
  const claudeConfigRoot = resolveClaudeSettingsRoot(context);
  const claudeSettingsPath = resolveClaudeSettingsPath(context);
  const command = createClaudeHookCommand(context);

  await fs.mkdir(claudeConfigRoot, { recursive: true });
  await assertSafeClaudeSettingsPath(claudeConfigRoot, claudeSettingsPath);

  const currentSettings = await readClaudeSettings(claudeSettingsPath);
  const currentHooks =
    currentSettings.hooks && typeof currentSettings.hooks === "object" && !Array.isArray(currentSettings.hooks)
      ? currentSettings.hooks
      : {};
  const currentPreToolUseGroups = normalizeHookGroups(currentHooks[CLAUDE_HOOK_EVENT_NAME]).filter(
    (group) => !isGuidanceBankClaudeHookGroup(group, command),
  );

  currentPreToolUseGroups.push({
    matcher: CLAUDE_HOOK_MATCHER,
    hooks: [
      {
        type: "command",
        command,
      },
    ],
  });

  const nextSettings: ClaudeSettings = {
    ...currentSettings,
    hooks: {
      ...currentHooks,
      [CLAUDE_HOOK_EVENT_NAME]: currentPreToolUseGroups,
    },
  };

  await atomicWriteFile(claudeSettingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
};

const removeClaudeHookSettings = async (context: ProviderInstallerContext): Promise<void> => {
  const claudeConfigRoot = resolveClaudeSettingsRoot(context);
  const claudeSettingsPath = resolveClaudeSettingsPath(context);
  const command = createClaudeHookCommand(context);

  await fs.mkdir(claudeConfigRoot, { recursive: true });
  await assertSafeClaudeSettingsPath(claudeConfigRoot, claudeSettingsPath);

  const currentSettings = await readClaudeSettings(claudeSettingsPath);
  const currentHooks =
    currentSettings.hooks && typeof currentSettings.hooks === "object" && !Array.isArray(currentSettings.hooks)
      ? currentSettings.hooks
      : null;

  if (currentHooks === null) {
    return;
  }

  const currentPreToolUseGroups = normalizeHookGroups(currentHooks[CLAUDE_HOOK_EVENT_NAME]);
  const nextPreToolUseGroups = currentPreToolUseGroups.filter(
    (group) => !isGuidanceBankClaudeHookGroup(group, command),
  );

  if (nextPreToolUseGroups.length === currentPreToolUseGroups.length) {
    return;
  }

  const nextHooks: Record<string, unknown> = {
    ...currentHooks,
  };

  if (nextPreToolUseGroups.length === 0) {
    delete nextHooks[CLAUDE_HOOK_EVENT_NAME];
  } else {
    nextHooks[CLAUDE_HOOK_EVENT_NAME] = nextPreToolUseGroups;
  }

  const nextSettings: ClaudeSettings = {
    ...currentSettings,
    ...(Object.keys(nextHooks).length > 0 ? { hooks: nextHooks } : {}),
  };

  if (Object.keys(nextHooks).length === 0) {
    delete nextSettings.hooks;
  }

  await atomicWriteFile(claudeSettingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
};

const isExpectedClaudeServer = (rawOutput: string, context: ProviderInstallerContext): boolean =>
  rawOutput.includes("Scope: User config") &&
  rawOutput.includes(`Command: ${context.mcpServerConfig.command}`) &&
  rawOutput.includes(`Args: ${context.mcpServerConfig.args.join(" ")}`) &&
  rawOutput.includes(`GUIDANCEBANK_ROOT=${context.bankRoot}`) &&
  rawOutput.includes("GUIDANCEBANK_PROVIDER_ID=claude-code");

const isMissingServerMessage = (result: { stdout: string; stderr: string }): boolean =>
  /No .*MCP server found with name:/u.test(`${result.stdout}\n${result.stderr}`);

const cleanupLegacyServers = async (context: ProviderInstallerContext): Promise<void> => {
  for (const legacyServerName of LEGACY_GUIDANCEBANK_SERVER_NAMES) {
    const removeResult = await context.commandRunner(buildRemoveLegacyCommand(legacyServerName));

    if (removeResult.exitCode === 0 || isMissingServerMessage(removeResult)) {
      continue;
    }

    throw new GuidanceBankCliError(
      `Failed to remove legacy Claude Code MCP integration ${legacyServerName}: ${removeResult.stderr || removeResult.stdout || "Unknown error"}`,
    );
  }
};

export const installClaudeCodeIntegration = async (
  context: ProviderInstallerContext,
): Promise<ProviderInstallResult> => {
  await cleanupLegacyServers(context);

  const getCommand = {
    command: "claude",
    args: ["mcp", "get", GUIDANCEBANK_SERVER_NAME],
  };
  const currentServer = await context.commandRunner(getCommand);

  if (currentServer.exitCode === 0 && isExpectedClaudeServer(currentServer.stdout, context)) {
    await upsertClaudeHookSettings(context);

    return {
      descriptor: createProviderDescriptor(
        "claude-code",
        "Claude Code",
        context.mcpServerConfig,
      ),
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

  await upsertClaudeHookSettings(context);

  return {
    descriptor: createProviderDescriptor(
      "claude-code",
      "Claude Code",
      context.mcpServerConfig,
    ),
    command: addCommand,
    action,
  };
};

export const uninstallClaudeCodeIntegration = async (
  context: ProviderInstallerContext,
): Promise<ProviderUninstallResult> => {
  await cleanupLegacyServers(context);
  await removeClaudeHookSettings(context);

  const command = buildRemoveCommand();
  const result = await context.commandRunner(command);

  if (result.exitCode === 0) {
    return {
      provider: "claude-code",
      displayName: "Claude Code",
      command,
      action: "removed",
    };
  }

  if (isMissingServerMessage(result)) {
    return {
      provider: "claude-code",
      displayName: "Claude Code",
      command,
      action: "already_absent",
    };
  }

  throw new GuidanceBankCliError(
    `Failed to remove Claude Code MCP integration: ${result.stderr || result.stdout || "Unknown error"}`,
  );
};
