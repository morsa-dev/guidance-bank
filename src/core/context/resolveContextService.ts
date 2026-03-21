import type { BankRepository } from "../../storage/bankRepository.js";
import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../bank/canonicalEntry.js";
import { ValidationError } from "../../shared/errors.js";
import { detectProjectContext } from "./detectProjectContext.js";
import type { ResolvedContextEntry, ResolvedMemoryBankContext } from "./types.js";
import { findReferenceProjects } from "../projects/findReferenceProjects.js";
import { resolveProjectIdentity } from "../projects/identity.js";

type ResolveContextOptions = {
  repository: BankRepository;
  projectPath: string;
};

type CandidateReason = {
  selected: boolean;
  reason: string;
};

const isDocumentationFile = (entryPath: string): boolean => {
  const normalizedEntryPath = entryPath.replaceAll("\\", "/").toLowerCase();
  return normalizedEntryPath.endsWith("/readme.md") || normalizedEntryPath === "readme.md";
};

const matchesStacks = (entryStacks: readonly string[], detectedStacks: readonly string[]): CandidateReason => {
  if (entryStacks.length === 0) {
    return {
      selected: true,
      reason: "Always-on canonical entry.",
    };
  }

  for (const stack of entryStacks) {
    if (detectedStacks.includes(stack)) {
      return {
        selected: true,
        reason: `Matches canonical stack metadata: ${stack}.`,
      };
    }
  }

  return {
    selected: false,
    reason: "",
  };
};

const parseRuleEntry = (layer: "shared" | "project", entryPath: string, content: string) => {
  try {
    return parseCanonicalRuleDocument(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown canonical rule parsing error.";
    throw new ValidationError(`Invalid canonical rule at ${layer}/${entryPath}: ${message}`);
  }
};

const parseSkillEntry = (layer: "shared" | "project", entryPath: string, content: string) => {
  try {
    return parseCanonicalSkillDocument(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown canonical skill parsing error.";
    throw new ValidationError(`Invalid canonical skill at ${layer}/${entryPath}: ${message}`);
  }
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

    const content = await repository.readLayerEntry(layer, kind, entry.path, projectId);
    const metadata =
      kind === "rules"
        ? parseRuleEntry(layer, entry.path, content).frontmatter
        : parseSkillEntry(layer, entry.path, content).frontmatter;
    const selection = matchesStacks(metadata.stacks, detectedStacks);

    if (!selection.selected) {
      continue;
    }

    const resolvedEntry: ResolvedContextEntry = {
      layer,
      path: entry.path,
      reason: selection.reason,
      content,
    };
    resolvedEntry.metadata = metadata;

    selectedEntries.push(resolvedEntry);
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

const renderEntrySection = (title: string, entries: readonly ResolvedContextEntry[]): string => {
  if (entries.length === 0) {
    return `## ${title}

No ${title.toLowerCase()} matched for this repository.`;
  }

  const blocks = entries.map(
    (entry) => `### ${entry.layer}/${entry.path}

${entry.content.trim()}`,
  );

  return `## ${title}

${blocks.join("\n\n")}`;
};

const renderReferenceProjects = (projectPaths: readonly string[]): string =>
  projectPaths.map((projectPath, index) => `${index + 1}. ${projectPath}`).join("\n");

const buildReadyText = ({
  projectPath,
  detectedStacks,
  localGuidancePaths,
  rules,
  skills,
}: {
  projectPath: string;
  detectedStacks: readonly string[];
  localGuidancePaths: readonly string[];
  rules: readonly ResolvedContextEntry[];
  skills: readonly ResolvedContextEntry[];
}): string => {
  const detectedStacksLine =
    detectedStacks.length > 0 ? `Detected stack signals: ${detectedStacks.join(", ")}.` : "No stable stack signals were detected automatically.";
  const localGuidanceLine =
    localGuidancePaths.length > 0
      ? `Repository-local guidance exists and may be used only as reference or migration input: ${localGuidancePaths.join(", ")}.`
      : "No repository-local AGENTS/.cursor/.claude/.codex guidance was detected.";

  return `Use the following Memory Bank context as the primary user-managed context for this repository.

Repository: ${projectPath}
${detectedStacksLine}
${localGuidanceLine}

${renderEntrySection("Rules", rules)}

${renderEntrySection("Skills", skills)}`;
};

const buildMissingText = ({
  referenceProjectPaths,
}: {
  referenceProjectPaths: readonly string[];
}): string => {
  const referenceSection =
    referenceProjectPaths.length > 0
      ? `\n\nBefore creating a new project Memory Bank, offer these existing project banks as optional reference bases:\n${renderReferenceProjects(referenceProjectPaths)}`
      : "";

  return `No project Memory Bank exists for this repository. Ask the user whether to create one before doing substantial project-specific work.${referenceSection}`;
};

const buildDeclinedText = (): string =>
  "Project Memory Bank creation was previously declined for this repository. Do not ask again unless the user explicitly requests Memory Bank creation. Continue using only the shared Memory Bank context for now.";

export const resolveMemoryBankContext = async ({
  repository,
  projectPath,
}: ResolveContextOptions): Promise<ResolvedMemoryBankContext> => {
  const identity = resolveProjectIdentity(projectPath);
  const detectedProjectContext = await detectProjectContext(identity.projectPath);
  const projectManifest = await repository.readProjectManifestOptional(identity.projectId);
  const projectState = await repository.readProjectStateOptional(identity.projectId);
  const referenceProjects = await findReferenceProjects({
    repository,
    currentProjectId: identity.projectId,
    detectedStacks: detectedProjectContext.detectedStacks,
  });

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

  const mergedRules = mergeLayeredEntries(sharedRules, projectRules);
  const mergedSkills = mergeLayeredEntries(sharedSkills, projectSkills);
  const text =
    status === "ready"
      ? buildReadyText({
          projectPath: identity.projectPath,
          detectedStacks: detectedProjectContext.detectedStacks,
          localGuidancePaths: detectedProjectContext.localGuidance.map((signal) => signal.path),
          rules: mergedRules,
          skills: mergedSkills,
        })
      : status === "creation_declined"
        ? buildDeclinedText()
        : buildMissingText({
            referenceProjectPaths: referenceProjects.map((project) => project.projectPath),
          });

  return referenceProjects.length > 0 && status === "missing"
    ? {
        text,
        referenceProjects,
      }
    : {
        text,
      };
};
