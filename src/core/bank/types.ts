import type { DetectableStack } from "../context/types.js";
import type { ConfirmedGuidanceSourceStrategy } from "../projects/guidanceStrategies.js";

export const PROVIDER_IDS = ["codex", "cursor", "claude-code"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const STORAGE_VERSIONS = [1, 2] as const;
export type StorageVersion = (typeof STORAGE_VERSIONS)[number];
export const CURRENT_STORAGE_VERSION = 2 as const;

export const ENTRY_KINDS = ["rules", "skills"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_SCOPES = ["shared", "project"] as const;
export type EntryScope = (typeof ENTRY_SCOPES)[number];
export const PROJECT_CREATION_STATES = ["unknown", "postponed", "declined", "creating", "ready"] as const;
export type ProjectCreationState = (typeof PROJECT_CREATION_STATES)[number];

export type MemoryBankManifest = {
  schemaVersion: 1;
  storageVersion: StorageVersion;
  bankId: string;
  createdAt: string;
  updatedAt: string;
  enabledProviders: ProviderId[];
  defaultMcpTransport: "stdio";
};

export type McpServerConfig = {
  schemaVersion: 1;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type ProjectBankManifest = {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  projectPath: string;
  detectedStacks: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectBankState = {
  schemaVersion: 1;
  creationState: ProjectCreationState;
  createIteration: number | null;
  sourceStrategies: ConfirmedGuidanceSourceStrategy[];
  postponedUntil: string | null;
  lastSyncedAt: string | null;
  lastSyncedStorageVersion: number | null;
  updatedAt: string;
};

export type ProviderIntegrationDescriptor = {
  schemaVersion: 1;
  provider: ProviderId;
  displayName: string;
  serverName: string;
  installationMethod: "provider-cli" | "config-file";
  scope: "user";
  mcpServer: McpServerConfig;
  instructions: string[];
};

export type ListedEntry = {
  path: string;
};

export type CanonicalEntryFrontmatterBase = {
  id: string;
  title: string;
  stacks: DetectableStack[];
  topics: string[];
};

export type CanonicalRuleFrontmatter = CanonicalEntryFrontmatterBase & {
  kind: "rule";
};

export type CanonicalSkillFrontmatter = CanonicalEntryFrontmatterBase & {
  kind: "skill";
  description: string;
  name?: string | undefined;
};

export type CanonicalRuleDocument = {
  frontmatter: CanonicalRuleFrontmatter;
  body: string;
};

export type CanonicalSkillDocument = {
  frontmatter: CanonicalSkillFrontmatter;
  body: string;
};
