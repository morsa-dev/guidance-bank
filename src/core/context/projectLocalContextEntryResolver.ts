import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../bank/canonicalEntry.js";
import { ValidationError } from "../../shared/errors.js";
import type { ProjectLocalEntryStore } from "../../storage/projectLocalEntryStore.js";
import type { ResolvedContextEntry } from "./types.js";

const isDocumentationFile = (entryPath: string): boolean => {
  const normalized = entryPath.replaceAll("\\", "/").toLowerCase();
  return normalized.endsWith("/readme.md") || normalized === "readme.md";
};

const matchesStack = (
  selector: { stack?: string | undefined; alwaysOn?: true | undefined },
  detectedStacks: readonly string[],
): { selected: boolean; reason: string } => {
  if (selector.alwaysOn === true) return { selected: true, reason: "Always-on canonical entry." };
  if (selector.stack !== undefined && detectedStacks.includes(selector.stack)) {
    return { selected: true, reason: `Matches canonical stack metadata: ${selector.stack}.` };
  }
  return { selected: false, reason: "" };
};

export const loadProjectLocalContextEntries = async (
  store: ProjectLocalEntryStore,
  kind: "rules" | "skills",
  detectedStacks: readonly string[],
): Promise<ResolvedContextEntry[]> => {
  const entries = await store.listEntries(kind);
  const selected: ResolvedContextEntry[] = [];

  for (const entry of entries) {
    if (isDocumentationFile(entry.path)) continue;

    const content = await store.readEntry(kind, entry.path);

    let metadata: ResolvedContextEntry["metadata"];
    try {
      metadata =
        kind === "rules"
          ? parseCanonicalRuleDocument(content).frontmatter
          : parseCanonicalSkillDocument(content).frontmatter;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      throw new ValidationError(`Invalid canonical ${kind.slice(0, -1)} at project-local/${entry.path}: ${message}`);
    }

    const match = matchesStack(metadata, detectedStacks);
    if (!match.selected) continue;

    selected.push({
      layer: "project",
      path: entry.path,
      reason: match.reason,
      content,
      metadata,
    });
  }

  return selected;
};
