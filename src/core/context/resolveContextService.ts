import path from "node:path";

import type { BankRepository } from "../../storage/bankRepository.js";
import { detectProjectContext } from "./detectProjectContext.js";
import type { ResolvedContextEntry, ResolvedMemoryBankContext } from "./types.js";
import { resolveProjectIdentity } from "../projects/identity.js";

type ResolveContextOptions = {
  repository: BankRepository;
  projectPath: string;
};

type CandidateReason = {
  selected: boolean;
  reason: string;
};

const normalizeEntryPath = (entryPath: string): string => entryPath.replaceAll("\\", "/");

const isDocumentationFile = (entryPath: string): boolean => {
  const normalizedEntryPath = normalizeEntryPath(entryPath).toLowerCase();
  return normalizedEntryPath.endsWith("/readme.md") || normalizedEntryPath === "readme.md";
};

const explainRuleSelection = (entryPath: string, detectedStacks: readonly string[]): CandidateReason => {
  const normalizedEntryPath = normalizeEntryPath(entryPath);

  if (normalizedEntryPath.startsWith("core/")) {
    return {
      selected: true,
      reason: "Always-on core rule.",
    };
  }

  if (normalizedEntryPath.startsWith("topics/")) {
    return {
      selected: true,
      reason: "Shared topic rule available to all projects unless overridden locally.",
    };
  }

  for (const stack of detectedStacks) {
    if (normalizedEntryPath.startsWith(`stacks/${stack}/`)) {
      return {
        selected: true,
        reason: `Matches detected stack: ${stack}.`,
      };
    }
  }

  return {
    selected: false,
    reason: "",
  };
};

const explainSkillSelection = (entryPath: string, detectedStacks: readonly string[]): CandidateReason => {
  const normalizedEntryPath = normalizeEntryPath(entryPath);

  if (normalizedEntryPath.startsWith("shared/")) {
    return {
      selected: true,
      reason: "Shared reusable workflow.",
    };
  }

  for (const stack of detectedStacks) {
    if (normalizedEntryPath.startsWith(`stacks/${stack}/`)) {
      return {
        selected: true,
        reason: `Matches detected stack: ${stack}.`,
      };
    }
  }

  return {
    selected: false,
    reason: "",
  };
};

const loadEntries = async (
  repository: BankRepository,
  layer: "shared" | "project",
  kind: "rules" | "skills",
  detectedStacks: readonly string[],
  projectId?: string,
): Promise<ResolvedContextEntry[]> => {
  const entries = await repository.listLayerEntries(layer, kind, projectId);
  const selectedEntries: ResolvedContextEntry[] = [];

  for (const entry of entries) {
    if (isDocumentationFile(entry.path)) {
      continue;
    }

    const selection = kind === "rules" ? explainRuleSelection(entry.path, detectedStacks) : explainSkillSelection(entry.path, detectedStacks);

    if (!selection.selected) {
      continue;
    }

    const content = await repository.readLayerEntry(layer, kind, entry.path, projectId);
    selectedEntries.push({
      layer,
      path: entry.path,
      reason: selection.reason,
      content,
    });
  }

  return selectedEntries;
};

const mergeLayeredEntries = (
  sharedEntries: ResolvedContextEntry[],
  projectEntries: ResolvedContextEntry[],
): ResolvedContextEntry[] => {
  const mergedEntries = new Map<string, ResolvedContextEntry>();

  for (const entry of sharedEntries) {
    mergedEntries.set(entry.path, entry);
  }

  for (const entry of projectEntries) {
    mergedEntries.set(entry.path, entry);
  }

  return [...mergedEntries.values()].sort((left, right) => left.path.localeCompare(right.path));
};

export const resolveMemoryBankContext = async ({
  repository,
  projectPath,
}: ResolveContextOptions): Promise<ResolvedMemoryBankContext> => {
  const identity = resolveProjectIdentity(projectPath);
  const detectedProjectContext = await detectProjectContext(identity.projectPath);
  const projectManifest = await repository.readProjectManifestOptional(identity.projectId);
  const projectState = await repository.readProjectStateOptional(identity.projectId);

  const sharedRules = await loadEntries(repository, "shared", "rules", detectedProjectContext.detectedStacks);
  const sharedSkills = await loadEntries(repository, "shared", "skills", detectedProjectContext.detectedStacks);

  const projectRules =
    projectManifest !== null
      ? await loadEntries(repository, "project", "rules", detectedProjectContext.detectedStacks, identity.projectId)
      : [];
  const projectSkills =
    projectManifest !== null
      ? await loadEntries(repository, "project", "skills", detectedProjectContext.detectedStacks, identity.projectId)
      : [];

  const status =
    projectManifest !== null
      ? "ready"
      : projectState?.creationState === "declined"
        ? "creation_declined"
        : "missing";

  const message =
    status === "ready"
      ? "Project Memory Bank found. Use the resolved Memory Bank context below as the primary agent context for this repository."
      : status === "creation_declined"
        ? "No project Memory Bank exists for this repository, and the user previously declined creation."
        : "No project Memory Bank exists for this repository yet.";

  const agentInstructions =
    status === "ready"
      ? "Use the resolved Memory Bank rules and skills as the primary user-managed context for this repository. Apply project-layer entries as overrides over shared guidance. If local AGENTS.md, .cursor, .claude, or .codex files exist, treat them as repository-local reference or migration input rather than the canonical Memory Bank source."
      : status === "creation_declined"
        ? "Use only the shared Memory Bank context for now as the primary user-managed context. Do not ask to create a project Memory Bank again unless the user explicitly requests it. If local AGENTS.md, .cursor, .claude, or .codex files exist, they can still be used as repository-local reference."
        : "Use the shared Memory Bank context for now as the primary user-managed context. Before project-specific work becomes substantial, ask the user whether to create a project Memory Bank. If the user agrees, call create_bank. If the user declines, persist that choice through set_project_state. If local AGENTS.md, .cursor, .claude, or .codex files exist, they can be used as migration/reference input for the new Memory Bank.";

  return {
    projectId: identity.projectId,
    projectName: detectedProjectContext.projectName,
    projectPath: identity.projectPath,
    detectedStacks: detectedProjectContext.detectedStacks,
    detectedSignals: detectedProjectContext.detectedSignals,
    localGuidance: detectedProjectContext.localGuidance,
    status,
    message,
    projectBankPath: path.join(repository.paths.projectsDirectory, identity.projectId),
    rules: mergeLayeredEntries(sharedRules, projectRules),
    skills: mergeLayeredEntries(sharedSkills, projectSkills),
    agentInstructions,
  };
};
