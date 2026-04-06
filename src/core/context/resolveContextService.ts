import type { BankRepository } from "../../storage/bankRepository.js";
import {
  getProjectBankContinuationIteration,
  resolveProjectBankLifecycleStatus,
} from "../bank/lifecycle.js";
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

type EntrySelectionKind = "rules" | "skills";

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
      metadata,
    };

    selectedEntries.push(resolvedEntry);
  }

  return selectedEntries;
};

const assertUniqueEntryIds = (
  entries: readonly ResolvedContextEntry[],
  layer: "shared" | "project",
  kind: EntrySelectionKind,
): void => {
  const pathsById = new Map<string, string[]>();

  for (const entry of entries) {
    const existingPaths = pathsById.get(entry.metadata.id) ?? [];
    existingPaths.push(entry.path);
    pathsById.set(entry.metadata.id, existingPaths);
  }

  for (const [entryId, entryPaths] of pathsById) {
    if (entryPaths.length > 1) {
      throw new ValidationError(
        `Duplicate canonical ${kind.slice(0, -1)} id "${entryId}" in ${layer} layer: ${entryPaths.join(", ")}`,
      );
    }
  }
};

const mergeLayeredEntries = (
  sharedEntries: ResolvedContextEntry[],
  projectEntries: ResolvedContextEntry[],
): ResolvedContextEntry[] => {
  const mergedEntries = new Map<string, ResolvedContextEntry>();

  for (const entry of sharedEntries) {
    mergedEntries.set(entry.metadata.id, entry);
  }

  for (const entry of projectEntries) {
    mergedEntries.set(entry.metadata.id, entry);
  }

  return [...mergedEntries.values()].sort((left, right) => {
    const titleComparison = left.metadata.title.localeCompare(right.metadata.title);
    if (titleComparison !== 0) {
      return titleComparison;
    }

    return left.path.localeCompare(right.path);
  });
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
  rules,
  skills,
}: {
  projectPath: string;
  detectedStacks: readonly string[];
  rules: readonly ResolvedContextEntry[];
  skills: readonly ResolvedContextEntry[];
}): string => {
  const detectedStacksLine =
    detectedStacks.length > 0 ? `Detected stack signals: ${detectedStacks.join(", ")}.` : "No stable stack signals were detected automatically.";

  return `Use the following Memory Bank context as the primary user-managed context for this repository.

Repository: ${projectPath}
${detectedStacksLine}

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

  return `No project Memory Bank exists for this repository. Ask the user whether to create one before doing substantial project-specific work.${referenceSection}

- If the user wants to create it, call \`create_bank\`.
- If the user does not want to create it, call \`set_project_state\` with \`creationState: "declined"\`.
- After the user decision is recorded, call \`resolve_context\` again.`;
};

const buildCreatingText = ({
  nextIteration,
}: {
  nextIteration: number;
}): string => `Call \`create_bank\` with \`iteration: ${nextIteration}\`.`;

const buildDeclinedText = (): string =>
  "Project Memory Bank creation was previously declined for this repository. Do not ask again unless the user explicitly requests Memory Bank creation. If the user later wants to create it, call `create_bank` and then call `resolve_context` again.";

const buildSyncRequiredText = ({
  postponedUntil,
}: {
  postponedUntil: string | null;
}): string => {
  const postponeLine = postponedUntil
    ? `A previous sync was postponed until ${postponedUntil}, but that deferral has now expired.`
    : "This project Memory Bank has not been synced to the current Memory Bank storage version yet.";

  return `Project Memory Bank synchronization is required before using the project-specific bank.

${postponeLine}

Sync only reconciles the existing project bank with the current Memory Bank storage version. It does not create a new bank and does not replace the normal create or improve flow.

Ask the user whether to synchronize the project Memory Bank now or postpone it.
- If the user wants to sync now, call \`sync_bank\` with \`action: "run"\`.
- If the user wants to postpone, call \`sync_bank\` with \`action: "postpone"\`.
- After that, call \`resolve_context\` again.
- If the user later wants to create or improve project-specific content, continue with \`create_bank\` after synchronization is no longer required.`;
};

export const resolveMemoryBankContext = async ({
  repository,
  projectPath,
}: ResolveContextOptions): Promise<ResolvedMemoryBankContext> => {
  const identity = resolveProjectIdentity(projectPath);
  const manifest = await repository.readManifest();
  const detectedProjectContext = await detectProjectContext(identity.projectPath);
  const projectManifest = await repository.readProjectManifestOptional(identity.projectId);
  const projectState = await repository.readProjectStateOptional(identity.projectId);
  const status = resolveProjectBankLifecycleStatus({
    projectManifest,
    projectState,
    expectedStorageVersion: manifest.storageVersion,
  });

  if (status === "sync_required") {
    return {
      text: buildSyncRequiredText({
        postponedUntil: projectState?.postponedUntil ?? null,
      }),
      creationState: projectState?.creationState ?? "ready",
      requiredAction: "sync_bank",
    };
  }

  if (status === "creation_declined") {
    return {
      text: buildDeclinedText(),
      creationState: "declined",
    };
  }

  if (status === "missing") {
    const referenceProjects = await findReferenceProjects({
      repository,
      currentProjectId: identity.projectId,
      detectedStacks: detectedProjectContext.detectedStacks,
    });

    const text = buildMissingText({
      referenceProjectPaths: referenceProjects.map((project) => project.projectPath),
    });

    return referenceProjects.length > 0
      ? {
          text,
          creationState: projectState?.creationState ?? "unknown",
          requiredAction: "create_bank",
          referenceProjects,
        }
      : {
          text,
          creationState: projectState?.creationState ?? "unknown",
          requiredAction: "create_bank",
        };
  }

  if (status === "creation_in_progress") {
    const nextIteration = getProjectBankContinuationIteration(projectState);

    return {
      text: buildCreatingText({
        nextIteration,
      }),
      creationState: "creating",
      requiredAction: "continue_create_bank",
      nextIteration,
    };
  }

  const sharedRules = await loadEntries(repository, "shared", "rules", detectedProjectContext.detectedStacks);
  const sharedSkills = await loadEntries(repository, "shared", "skills", detectedProjectContext.detectedStacks);
  const projectRules = await loadEntries(repository, "project", "rules", detectedProjectContext.detectedStacks, identity.projectId);
  const projectSkills = await loadEntries(
    repository,
    "project",
    "skills",
    detectedProjectContext.detectedStacks,
    identity.projectId,
  );

  assertUniqueEntryIds(sharedRules, "shared", "rules");
  assertUniqueEntryIds(sharedSkills, "shared", "skills");
  assertUniqueEntryIds(projectRules, "project", "rules");
  assertUniqueEntryIds(projectSkills, "project", "skills");

  return {
    text: buildReadyText({
      projectPath: identity.projectPath,
      detectedStacks: detectedProjectContext.detectedStacks,
      rules: mergeLayeredEntries(sharedRules, projectRules),
      skills: mergeLayeredEntries(sharedSkills, projectSkills),
    }),
    creationState: "ready",
  };
};
