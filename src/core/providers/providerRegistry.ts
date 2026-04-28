import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { installClaudeCodeIntegration, uninstallClaudeCodeIntegration } from "../../integrations/claudeCode/install.js";
import { installCodexIntegration, uninstallCodexIntegration } from "../../integrations/codex/install.js";
import { installCursorIntegration, uninstallCursorIntegration } from "../../integrations/cursor/install.js";
import { PROVIDER_IDS, type ProviderId } from "../bank/types.js";
import type { ProviderDefinition } from "./types.js";

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const isCursorEnvironmentAvailable = async (): Promise<boolean> =>
  (await pathExists(path.join(os.homedir(), ".cursor"))) ||
  (await pathExists(path.join(os.homedir(), "Library", "Application Support", "Cursor")));

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: "codex",
    displayName: "Codex",
    cliCommand: "codex",
    unavailableMessage: "Codex CLI was not found on PATH.",
    install: installCodexIntegration,
    uninstall: uninstallCodexIntegration,
  },
  {
    id: "cursor",
    displayName: "Cursor",
    cliCommand: "cursor",
    unavailableMessage: "Cursor local configuration directories were not found.",
    isAvailable: isCursorEnvironmentAvailable,
    install: installCursorIntegration,
    uninstall: uninstallCursorIntegration,
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    cliCommand: "claude",
    unavailableMessage: "Claude Code CLI was not found on PATH.",
    install: installClaudeCodeIntegration,
    uninstall: uninstallClaudeCodeIntegration,
  },
];

const providerMap = new Map<ProviderId, ProviderDefinition>(PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition]));

export const getProviderDefinition = (providerId: ProviderId): ProviderDefinition => {
  const definition = providerMap.get(providerId);
  if (!definition) {
    throw new Error(`Unsupported provider: ${providerId}`);
  }

  return definition;
};

export const isProviderId = (value: string): value is ProviderId =>
  (PROVIDER_IDS as readonly string[]).includes(value);
