import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../bank/canonicalEntry.js";
import { ValidationError } from "../../shared/errors.js";
import type { BankRepository } from "../../storage/bankRepository.js";
import type {
  ResolvedContextCatalogEntry,
  ResolvedContextEntry,
  ResolvedContextInlineRule,
} from "./types.js";

type CandidateReason = {
  selected: boolean;
  reason: string;
};

type EntrySelectionKind = "rules" | "skills";

const isDocumentationFile = (entryPath: string): boolean => {
  const normalizedEntryPath = entryPath.replaceAll("\\", "/").toLowerCase();
  return normalizedEntryPath.endsWith("/readme.md") || normalizedEntryPath === "readme.md";
};

const matchesStack = (
  entrySelector: { stack?: string | undefined; alwaysOn?: true | undefined },
  detectedStacks: readonly string[],
): CandidateReason => {
  if (entrySelector.alwaysOn === true) {
    return {
      selected: true,
      reason: "Always-on canonical entry.",
    };
  }

  if (entrySelector.stack !== undefined && detectedStacks.includes(entrySelector.stack)) {
    return {
      selected: true,
      reason: `Matches canonical stack metadata: ${entrySelector.stack}.`,
    };
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

export const loadResolvedContextEntries = async (
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
    const selection = matchesStack(metadata, detectedStacks);

    if (!selection.selected) {
      continue;
    }

    selectedEntries.push({
      layer,
      path: entry.path,
      reason: selection.reason,
      content,
      metadata,
    });
  }

  return selectedEntries;
};

export const assertUniqueResolvedEntryIds = (
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

export const mergeResolvedLayerEntries = (
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

const stripFrontmatter = (content: string): string => content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "");

const toPreview = (content: string): string | null => {
  const body = stripFrontmatter(content);
  const lines = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const previewSource = lines[0] ?? null;
  if (previewSource === null) {
    return null;
  }

  return previewSource.length > 180 ? `${previewSource.slice(0, 177)}...` : previewSource;
};

export const selectAlwaysOnRules = (entries: readonly ResolvedContextEntry[]): ResolvedContextInlineRule[] =>
  entries
    .filter((entry) => entry.metadata.kind === "rule" && entry.metadata.alwaysOn === true)
    .map((entry) => ({
      scope: entry.layer,
      path: entry.path,
      id: entry.metadata.id,
      title: entry.metadata.title,
      topics: [...entry.metadata.topics],
      content: entry.content,
    }));

export const excludeAlwaysOnRules = (entries: readonly ResolvedContextEntry[]): ResolvedContextEntry[] =>
  entries.filter((entry) => !(entry.metadata.kind === "rule" && entry.metadata.alwaysOn === true));

export const buildResolvedContextCatalog = (
  kind: "rules" | "skills",
  entries: readonly ResolvedContextEntry[],
): ResolvedContextCatalogEntry[] =>
  entries.map((entry) => ({
    scope: entry.layer,
    kind,
    path: entry.path,
    title: entry.metadata.title,
    topics: [...entry.metadata.topics],
    description: entry.metadata.kind === "skill" ? entry.metadata.description : toPreview(entry.content),
  }));
