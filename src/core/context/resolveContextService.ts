import type { BankRepository } from "../../storage/bankRepository.js";
import {
  parseCanonicalRuleDocumentOptional,
  parseCanonicalSkillDocumentOptional,
} from "../bank/canonicalEntry.js";
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

const normalizeEntryPath = (entryPath: string): string => entryPath.replaceAll("\\", "/");

const isDocumentationFile = (entryPath: string): boolean => {
  const normalizedEntryPath = normalizeEntryPath(entryPath).toLowerCase();
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

const explainRuleSelection = (entryPath: string, detectedStacks: readonly string[], content: string): CandidateReason => {
  const normalizedEntryPath = normalizeEntryPath(entryPath);
  const canonicalDocument = parseCanonicalRuleDocumentOptional(content);

  if (canonicalDocument.document) {
    return matchesStacks(canonicalDocument.document.frontmatter.stacks, detectedStacks);
  }

  if (!normalizedEntryPath.startsWith("stacks/")) {
    return {
      selected: true,
      reason: "Always-on legacy shared or project rule.",
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

const explainSkillSelection = (entryPath: string, detectedStacks: readonly string[], content: string): CandidateReason => {
  const normalizedEntryPath = normalizeEntryPath(entryPath);
  const canonicalDocument = parseCanonicalSkillDocumentOptional(content);

  if (canonicalDocument.document) {
    return matchesStacks(canonicalDocument.document.frontmatter.stacks, detectedStacks);
  }

  if (!normalizedEntryPath.startsWith("stacks/")) {
    return {
      selected: true,
      reason: "Always-on legacy shared or project workflow.",
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

    const content = await repository.readLayerEntry(layer, kind, entry.path, projectId);
    const selection =
      kind === "rules"
        ? explainRuleSelection(entry.path, detectedStacks, content)
        : explainSkillSelection(entry.path, detectedStacks, content);

    if (!selection.selected) {
      continue;
    }

    const metadata =
      kind === "rules"
        ? parseCanonicalRuleDocumentOptional(content).document?.frontmatter
        : parseCanonicalSkillDocumentOptional(content).document?.frontmatter;
    const resolvedEntry: ResolvedContextEntry = {
      layer,
      path: entry.path,
      reason: selection.reason,
      content,
    };

    if (metadata) {
      resolvedEntry.metadata = metadata;
    }

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
