import { installClaudeCodeIntegration } from "../../integrations/claudeCode/install.js";
import { installCodexIntegration } from "../../integrations/codex/install.js";
import { installCursorIntegration } from "../../integrations/cursor/install.js";
import { PROVIDER_IDS, type ProviderId } from "../bank/types.js";
import type { ProviderDefinition } from "./types.js";

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: "codex",
    displayName: "Codex",
    install: installCodexIntegration,
  },
  {
    id: "cursor",
    displayName: "Cursor",
    install: installCursorIntegration,
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    install: installClaudeCodeIntegration,
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
