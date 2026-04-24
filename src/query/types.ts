import type { EntryKind, EntryScope, MemoryBankManifest, ProjectCreationState } from "../core/bank/types.js";

export type GuidanceBankEntryCounts = {
  rules: number;
  skills: number;
};

export type GuidanceBankProjectSummary = {
  total: number;
  byCreationState: Record<string, number>;
};

export type GuidanceBankAvailableProject = {
  projectId: string;
  projectName: string;
  projectPath: string;
  detectedStacks: string[];
  updatedAt: string;
};

export type GuidanceBankSelectedProject =
  | {
      status: "none";
      projectPath: null;
    }
  | {
      status: "project_missing";
      projectPath: string;
    }
  | {
      status: "ready";
      projectPath: string;
      projectId: string;
      projectName: string;
      detectedStacks: string[];
      creationState: ProjectCreationState | "unknown";
      updatedAt: string;
      entries: GuidanceBankEntryCounts;
    };

export type GuidanceBankBootstrap = {
  bankRoot: string;
  defaultProjectPath: string | null;
  manifest: Pick<
    MemoryBankManifest,
    "bankId" | "storageVersion" | "createdAt" | "updatedAt" | "enabledProviders" | "defaultMcpTransport"
  >;
  sharedEntries: GuidanceBankEntryCounts;
  projectSummary: GuidanceBankProjectSummary;
  availableProjects: GuidanceBankAvailableProject[];
  selectedProject: GuidanceBankSelectedProject;
};

export type GuidanceBankEntrySummary = {
  scope: EntryScope;
  kind: EntryKind;
  path: string;
  filePath: string;
  id: string;
  title: string;
  stacks: string[];
  topics: string[];
  description: string | null;
  bodyPreview: string;
};

export type GuidanceBankEntryDetail = GuidanceBankEntrySummary & {
  content: string;
  body: string;
};

export type GuidanceBankListEntriesArgs = {
  scope: EntryScope;
  kind: EntryKind;
  projectPath?: string;
};

export type GuidanceBankReadEntryArgs = GuidanceBankListEntriesArgs & {
  path: string;
};
