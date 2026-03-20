import { type ProviderId } from "../bank/types.js";
import type { BankRepository } from "../../storage/bankRepository.js";
import { detectProjectContext } from "./detectProjectContext.js";
import type { ResolvedContextEntry, ResolvedMemoryBankContext } from "./types.js";

type ResolveContextOptions = {
  repository: BankRepository;
  cwd: string;
  provider?: ProviderId;
  task?: string;
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

const explainRuleSelection = (
  entryPath: string,
  detectedStacks: readonly string[],
  provider?: ProviderId,
): CandidateReason => {
  const normalizedEntryPath = normalizeEntryPath(entryPath);

  if (normalizedEntryPath.startsWith("core/")) {
    return {
      selected: true,
      reason: "Always-on user-level core rule.",
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

  if (provider && normalizedEntryPath.startsWith(`providers/${provider}/`)) {
    return {
      selected: true,
      reason: `Matches active provider: ${provider}.`,
    };
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
      reason: "Shared skill for cross-project workflows.",
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
  kind: "rules" | "skills",
  detectedStacks: readonly string[],
  provider?: ProviderId,
): Promise<ResolvedContextEntry[]> => {
  const entries = await repository.listEntries(kind);
  const selectedEntries: ResolvedContextEntry[] = [];

  for (const entry of entries) {
    if (isDocumentationFile(entry.path)) {
      continue;
    }

    const selection =
      kind === "rules"
        ? explainRuleSelection(entry.path, detectedStacks, provider)
        : explainSkillSelection(entry.path, detectedStacks);

    if (!selection.selected) {
      continue;
    }

    const content = await repository.readEntry(kind, entry.path);
    selectedEntries.push({
      path: entry.path,
      reason: selection.reason,
      content,
    });
  }

  return selectedEntries;
};

export const resolveMemoryBankContext = async ({
  repository,
  cwd,
  provider,
  task,
}: ResolveContextOptions): Promise<ResolvedMemoryBankContext> => {
  const projectContext = await detectProjectContext(cwd);
  const rules = await loadEntries(repository, "rules", projectContext.detectedStacks, provider);
  const skills = await loadEntries(repository, "skills", projectContext.detectedStacks, provider);

  return {
    ...projectContext,
    ...(provider ? { provider } : {}),
    ...(task ? { task } : {}),
    rules,
    skills,
    agentInstructions:
      "Call resolve_context at the start of work in a repository, use the returned rules as your Memory Bank baseline, and revisit the tool when the working directory or task changes materially.",
  };
};
