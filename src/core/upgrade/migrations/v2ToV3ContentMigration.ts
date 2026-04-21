import { promises as fs } from "node:fs";
import path from "node:path";

import {
  parseCanonicalRuleDocument,
  parseCanonicalSkillDocument,
  serializeCanonicalRuleFrontmatter,
  serializeCanonicalSkillFrontmatter,
} from "../../bank/canonicalEntry.js";
import { DETECTABLE_STACKS, type DetectableStack } from "../../context/types.js";
import { ValidationError } from "../../../shared/errors.js";
import {
  writeManagedTextFile,
  deleteManagedFile,
  listManagedChildDirectories,
  listManagedFilesRecursively,
} from "../../../storage/safeFs.js";
import type { BankRepository } from "../../../storage/bankRepository.js";
import type {
  BankContentMigrationAutoMigration,
  BankContentMigrationEntryKind,
  BankContentMigrationLayer,
  BankContentMigrationPreflight,
  BankContentMigrationResolutionIssue,
} from "../bankContentMigrationTypes.js";

type Layer = BankContentMigrationLayer;
type EntryKind = BankContentMigrationEntryKind;

type LayerMigrationOptions = {
  repository: BankRepository;
  layer: Layer;
  kind: EntryKind;
  projectId?: string;
};

type ParsedLegacyFrontmatter = {
  frontmatter: Record<string, unknown>;
  body: string;
};

type EntrySelector = {
  stack?: DetectableStack;
  alwaysOn?: true;
};

const DetectableStackSet = new Set<string>(DETECTABLE_STACKS);
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u;

const LEGACY_RULE_NAMESPACE_PREFIXES = new Set(["core", "topics"]);
const LEGACY_RULE_DOUBLE_PREFIXES = new Set(["providers", "stacks"]);
const LEGACY_SKILL_NAMESPACE_PREFIXES = new Set(["shared", "project"]);
const LEGACY_SKILL_DOUBLE_PREFIXES = new Set(["stacks"]);
const BANK_SUPPORT_FILE_BASENAMES = new Set([".DS_Store"]);

const createEmptyPreflight = (): BankContentMigrationPreflight => ({
  autoMigrations: [],
  requiresResolution: [],
});

const isSafeBeforeResolutionMigration = (migration: {
  pathChange: string | null;
  frontmatterChanges: readonly string[];
}): boolean => migration.pathChange !== null && migration.frontmatterChanges.length === 0;

const parseScalarValue = (rawValue: string): unknown => {
  const trimmedValue = rawValue.trim();

  if (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) {
    const innerValue = trimmedValue.slice(1, -1).trim();
    if (innerValue.length === 0) {
      return [];
    }

    return innerValue.split(",").map((item) => item.trim().replace(/^['"]|['"]$/gu, ""));
  }

  if (trimmedValue === "true") {
    return true;
  }

  if (trimmedValue === "false") {
    return false;
  }

  return trimmedValue.replace(/^['"]|['"]$/gu, "");
};

const parseFrontmatterBlock = (content: string): ParsedLegacyFrontmatter | null => {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return null;
  }

  const rawFrontmatter = match[1] ?? "";
  const body = match[2]?.trim() ?? "";
  const frontmatter: Record<string, unknown> = {};

  for (const line of rawFrontmatter.split(/\r?\n/u)) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf(":");
    if (separatorIndex <= 0) {
      throw new ValidationError(`Invalid frontmatter line during upgrade: ${trimmedLine}`);
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1);
    frontmatter[key] = parseScalarValue(rawValue);
  }

  return {
    frontmatter,
    body,
  };
};

const isDocumentationFile = (entryPath: string): boolean => {
  const normalizedEntryPath = entryPath.replaceAll("\\", "/").toLowerCase();
  return normalizedEntryPath.endsWith("/readme.md") || normalizedEntryPath === "readme.md";
};

const hasHiddenPathSegment = (entryPath: string): boolean =>
  entryPath
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment.startsWith("."));

const isEntryFile = (kind: EntryKind, entryPath: string): boolean => {
  if (hasHiddenPathSegment(entryPath)) {
    return false;
  }

  const normalizedPath = entryPath.replaceAll("\\", "/").toLowerCase();
  const basename = path.posix.basename(normalizedPath);

  if (kind === "rules") {
    return normalizedPath.endsWith(".md") && basename !== "readme.md" && basename !== "skill.md";
  }

  return basename === "skill.md";
};

const isAutoRemovableSupportFile = (entryPath: string): boolean =>
  hasHiddenPathSegment(entryPath) || isDocumentationFile(entryPath);

const normalizePathSegments = (entryPath: string): string[] =>
  entryPath.replaceAll("\\", "/").split("/").map((segment) => segment.trim()).filter((segment) => segment.length > 0);

const normalizeLegacyEntryPath = (kind: EntryKind, entryPath: string): string => {
  const segments = normalizePathSegments(entryPath);
  if (segments.length === 0) {
    return entryPath.replaceAll("\\", "/").trim();
  }

  if (kind === "rules") {
    if (LEGACY_RULE_NAMESPACE_PREFIXES.has(segments[0] ?? "") && segments.length > 1) {
      return segments.slice(1).join("/");
    }

    if (LEGACY_RULE_DOUBLE_PREFIXES.has(segments[0] ?? "") && segments.length > 2) {
      return segments.slice(2).join("/");
    }
  } else {
    if (LEGACY_SKILL_NAMESPACE_PREFIXES.has(segments[0] ?? "") && segments.length > 2) {
      return segments.slice(1).join("/");
    }

    if (LEGACY_SKILL_DOUBLE_PREFIXES.has(segments[0] ?? "") && segments.length > 3) {
      return segments.slice(2).join("/");
    }
  }

  return segments.join("/");
};

const isLegacyNamespacedDocumentationPath = (kind: EntryKind, entryPath: string): boolean => {
  if (!isDocumentationFile(entryPath)) {
    return false;
  }

  const firstSegment = normalizePathSegments(entryPath)[0] ?? "";

  return kind === "rules"
    ? LEGACY_RULE_NAMESPACE_PREFIXES.has(firstSegment) || LEGACY_RULE_DOUBLE_PREFIXES.has(firstSegment)
    : LEGACY_SKILL_NAMESPACE_PREFIXES.has(firstSegment) || LEGACY_SKILL_DOUBLE_PREFIXES.has(firstSegment);
};

const normalizeTopics = (rawTopics: unknown): string[] => {
  if (rawTopics === undefined) {
    return [];
  }

  if (!Array.isArray(rawTopics)) {
    throw new ValidationError("Legacy canonical entry has invalid topics metadata during upgrade.");
  }

  return rawTopics.map((topic) => {
    if (typeof topic !== "string" || topic.trim().length === 0) {
      throw new ValidationError("Legacy canonical entry has invalid topics metadata during upgrade.");
    }

    return topic.trim();
  });
};

const readStringField = (frontmatter: Record<string, unknown>, fieldName: string): string | null => {
  const value = frontmatter[fieldName];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const inferStackFromLegacyPath = (entryPath: string): DetectableStack | null => {
  const segments = normalizePathSegments(entryPath);
  const stacksIndex = segments.indexOf("stacks");
  const stack = stacksIndex >= 0 ? segments[stacksIndex + 1] : undefined;

  return stack && DetectableStackSet.has(stack) ? (stack as DetectableStack) : null;
};

const readLegacyStacks = (rawFrontmatter: Record<string, unknown>, entryLabel: string): DetectableStack[] | null => {
  if (!("stacks" in rawFrontmatter)) {
    return null;
  }

  const rawStacks = rawFrontmatter["stacks"];
  if (!Array.isArray(rawStacks)) {
    throw new ValidationError(`Legacy stacks metadata must be an array during upgrade for ${entryLabel}.`);
  }

  return rawStacks.map((stack) => {
    if (typeof stack !== "string" || stack.trim().length === 0) {
      throw new ValidationError(`Legacy stacks metadata contains an invalid value during upgrade for ${entryLabel}.`);
    }

    const normalizedStack = stack.trim();
    if (!DetectableStackSet.has(normalizedStack)) {
      throw new ValidationError(`Invalid stack value during upgrade for ${entryLabel}: ${normalizedStack}`);
    }

    return normalizedStack as DetectableStack;
  });
};

const summarizeFrontmatterChanges = (rawFrontmatter: Record<string, unknown>, selector: EntrySelector): string[] => {
  if (!("stacks" in rawFrontmatter)) {
    return [];
  }

  const legacyStacks = rawFrontmatter["stacks"];
  const legacyStackText = Array.isArray(legacyStacks) ? `[${legacyStacks.join(", ")}]` : String(legacyStacks);

  return selector.alwaysOn === true
    ? ["Replace legacy `stacks: []` with explicit `alwaysOn: true`."]
    : [`Replace legacy \`stacks: ${legacyStackText}\` with current singular \`stack: ${selector.stack}\`.`];
};

const createMultiStackIssue = ({
  layer,
  kind,
  projectId,
  path: entryPath,
  id,
  title,
  stacks,
  suggestedStack,
}: {
  layer: Layer;
  kind: EntryKind;
  projectId?: string;
  path: string;
  id: string | null;
  title: string | null;
  stacks: readonly DetectableStack[];
  suggestedStack?: DetectableStack | null;
}): BankContentMigrationResolutionIssue => ({
  reason: "multi_stack_frontmatter",
  scope: layer,
  kind,
  projectId: projectId ?? null,
  path: entryPath,
  id,
  title,
  legacyFrontmatter: [`stacks: [${stacks.join(", ")}]`],
  requiredCurrentFrontmatter: [
    "Use exactly one selector: `stack: <canonical-id>` or `alwaysOn: true`.",
    suggestedStack
      ? `Preferred migration for this entry: \`stack: ${suggestedStack}\`, because the legacy path or metadata points to that stack.`
      : "Prefer a concrete `stack` when the legacy path, metadata, or body points to one stack.",
    "Use `alwaysOn: true` only for truly global guidance that must be included for every repository.",
    "Do not keep `stacks`; it is not valid in the current canonical format.",
  ],
  resolutionPrinciple:
    "A current canonical entry can target one stack or be explicitly always-on. Prefer concrete stack selectors. Do not use alwaysOn as a fallback for ambiguity; use it only when the entry is intentionally global. Split only when separate stack-specific guidance is needed.",
  allowedResolutions: ["choose_single_stack", "make_always_on", "split_into_separate_entries"],
  agentNextStep:
    "Read this entry, rewrite it to the current canonical frontmatter using one allowed resolution, save the full document through upsert_rule/upsert_skill or direct file edit, then call upgrade_bank again.",
});

const createEntrySelectorIssue = ({
  layer,
  kind,
  projectId,
  path: entryPath,
  id,
  title,
}: {
  layer: Layer;
  kind: EntryKind;
  projectId?: string;
  path: string;
  id: string | null;
  title: string | null;
}): BankContentMigrationResolutionIssue => ({
  reason: "entry_selector_resolution",
  scope: layer,
  kind,
  projectId: projectId ?? null,
  path: entryPath,
  id,
  title,
  legacyFrontmatter: ["No current selector found: expected `stack`, `alwaysOn: true`, or legacy `stacks`."],
  requiredCurrentFrontmatter: [
    "Use exactly one selector: `stack: <canonical-id>` or `alwaysOn: true`.",
    "Use `stack` only when the entry clearly applies to one supported stack.",
    "Use `alwaysOn: true` only when the entry must be included for every repository.",
  ],
  resolutionPrinciple:
    "Do not infer always-on from a missing stack. Read the entry body and choose the explicit selector that matches the actual applicability.",
  allowedResolutions: ["choose_single_stack", "make_always_on", "split_into_separate_entries"],
  agentNextStep:
    "Read this entry, add exactly one current selector (`stack` or `alwaysOn: true`), save the full document through upsert_rule/upsert_skill or direct file edit, then call upgrade_bank again.",
});

const createPathCollisionIssue = ({
  layer,
  kind,
  projectId,
  desiredPath,
  collidingPaths,
}: {
  layer: Layer;
  kind: EntryKind;
  projectId?: string;
  desiredPath: string;
  collidingPaths: readonly string[];
}): BankContentMigrationResolutionIssue => ({
  reason: "path_collision",
  scope: layer,
  kind,
  projectId: projectId ?? null,
  path: desiredPath,
  id: null,
  title: null,
  legacyFrontmatter: [],
  requiredCurrentFrontmatter: [
    "Each migrated entry path must be unique inside its rules or skills root.",
    "Legacy namespace folders such as core/, topics/, providers/, stacks/, shared/, and project/ do not define matching behavior in the current format.",
  ],
  resolutionPrinciple:
    "Rename, merge, or delete the colliding legacy entries so that the flattened current layout has one clear canonical file for each final path.",
  allowedResolutions: [],
  agentNextStep:
    "Inspect the colliding paths, choose unique current paths or merge duplicates, save the corrected entries, then call upgrade_bank again.",
  collidingPaths: [...collidingPaths],
});

const createUnsupportedEntryFileIssue = ({
  layer,
  kind,
  projectId,
  path: entryPath,
}: {
  layer: Layer;
  kind: EntryKind;
  projectId?: string;
  path: string;
}): BankContentMigrationResolutionIssue => ({
  reason: "unsupported_entry_file",
  scope: layer,
  kind,
  projectId: projectId ?? null,
  path: entryPath,
  id: null,
  title: null,
  legacyFrontmatter: [],
  requiredCurrentFrontmatter:
    kind === "rules"
      ? [
          "A rule entry must be a `.md` file with current canonical rule frontmatter.",
          "The file cannot be README.md, SKILL.md, hidden, or a non-markdown support file inside the rules root.",
        ]
      : [
          "A skill entry must be a `SKILL.md` file inside a skill folder with current canonical skill frontmatter.",
          "The file cannot be README.md, hidden, or an arbitrary support file inside the skills root.",
        ],
  resolutionPrinciple:
    "Visible non-entry files inside rules or skills roots are ambiguous. Do not delete them automatically unless the user or agent decides they are obsolete.",
  allowedResolutions:
    kind === "rules"
      ? ["convert_to_rule_entry", "move_outside_bank", "remove_file"]
      : ["convert_to_skill_entry", "move_outside_bank", "remove_file"],
  agentNextStep:
    "Inspect this file. Either convert it into a current canonical entry, move it outside the AI Guidance Bank entry roots, or delete it if it is obsolete. Then call upgrade_bank again.",
});

const normalizeSelector = (rawFrontmatter: Record<string, unknown>, entryLabel: string): EntrySelector => {
  const hasCurrentStack = typeof rawFrontmatter["stack"] === "string";
  const hasCurrentAlwaysOn = rawFrontmatter["alwaysOn"] === true;

  if (hasCurrentStack && hasCurrentAlwaysOn) {
    throw new ValidationError(`Canonical selector cannot include both stack and alwaysOn during upgrade for ${entryLabel}.`);
  }

  if (typeof rawFrontmatter["stack"] === "string") {
    const stack = rawFrontmatter["stack"].trim();
    if (!DetectableStackSet.has(stack)) {
      throw new ValidationError(`Invalid stack value during upgrade for ${entryLabel}: ${stack}`);
    }

    return { stack: stack as DetectableStack };
  }

  if (hasCurrentAlwaysOn) {
    return { alwaysOn: true };
  }

  if (!("stacks" in rawFrontmatter)) {
    throw new ValidationError(`Missing canonical selector during upgrade for ${entryLabel}.`);
  }

  const stacks = readLegacyStacks(rawFrontmatter, entryLabel) ?? [];

  if (stacks.length === 0) {
    return { alwaysOn: true };
  }

  if (stacks.length > 1) {
    throw new ValidationError(
      `Cannot auto-upgrade ${entryLabel} with legacy stacks metadata containing multiple values: ${stacks.join(", ")}.`,
    );
  }

  return { stack: stacks[0]! };
};

const rewriteLegacyRuleContent = (content: string): string => {
  try {
    parseCanonicalRuleDocument(content);
    return content;
  } catch {
    const parsed = parseFrontmatterBlock(content);
    if (!parsed) {
      throw new ValidationError("Canonical rule files must start with a frontmatter block.");
    }

    const id = typeof parsed.frontmatter["id"] === "string" ? parsed.frontmatter["id"].trim() : "";
    const kind = typeof parsed.frontmatter["kind"] === "string" ? parsed.frontmatter["kind"].trim() : "";
    const title = typeof parsed.frontmatter["title"] === "string" ? parsed.frontmatter["title"].trim() : "";
    if (id.length === 0 || kind !== "rule" || title.length === 0) {
      throw new ValidationError("Legacy canonical rule metadata is incomplete during upgrade.");
    }

    const selector = normalizeSelector(parsed.frontmatter, `rule ${id}`);
    const topics = normalizeTopics(parsed.frontmatter["topics"]);
    const body = parsed.body.trim();
    if (body.length === 0) {
      throw new ValidationError(`Canonical rule body must not be empty during upgrade for ${id}.`);
    }

    return `${serializeCanonicalRuleFrontmatter({ id, kind: "rule", title, ...selector, topics })}\n\n${body}\n`;
  }
};

const rewriteLegacySkillContent = (content: string): string => {
  try {
    parseCanonicalSkillDocument(content);
    return content;
  } catch {
    const parsed = parseFrontmatterBlock(content);
    if (!parsed) {
      throw new ValidationError("Canonical skill files must start with a frontmatter block.");
    }

    const id = typeof parsed.frontmatter["id"] === "string" ? parsed.frontmatter["id"].trim() : "";
    const kind = typeof parsed.frontmatter["kind"] === "string" ? parsed.frontmatter["kind"].trim() : "";
    const title = typeof parsed.frontmatter["title"] === "string" ? parsed.frontmatter["title"].trim() : "";
    const description =
      typeof parsed.frontmatter["description"] === "string" ? parsed.frontmatter["description"].trim() : "";
    const rawName = typeof parsed.frontmatter["name"] === "string" ? parsed.frontmatter["name"].trim() : "";
    if (id.length === 0 || kind !== "skill" || title.length === 0 || description.length === 0) {
      throw new ValidationError("Legacy canonical skill metadata is incomplete during upgrade.");
    }

    const selector = normalizeSelector(parsed.frontmatter, `skill ${id}`);
    const topics = normalizeTopics(parsed.frontmatter["topics"]);
    const body = parsed.body.trim();
    if (body.length === 0) {
      throw new ValidationError(`Canonical skill body must not be empty during upgrade for ${id}.`);
    }

    return `${serializeCanonicalSkillFrontmatter({
      id,
      kind: "skill",
      title,
      ...(rawName.length > 0 ? { name: rawName } : {}),
      description,
      ...selector,
      topics,
    })}\n\n${body}\n`;
  }
};

const rewriteLegacyEntryContent = (kind: EntryKind, content: string): string =>
  kind === "rules" ? rewriteLegacyRuleContent(content) : rewriteLegacySkillContent(content);

const analyzeEntryContentForPreflight = ({
  layer,
  kind,
  projectId,
  path: entryPath,
  content,
}: {
  layer: Layer;
  kind: EntryKind;
  projectId?: string;
  path: string;
  content: string;
}): {
  rewrittenContent: string;
  frontmatterChanges: string[];
  issue: BankContentMigrationResolutionIssue | null;
} => {
  if (kind === "rules") {
    try {
      parseCanonicalRuleDocument(content);
      return {
        rewrittenContent: content,
        frontmatterChanges: [],
        issue: null,
      };
    } catch {
      const parsed = parseFrontmatterBlock(content);
      if (!parsed) {
        throw new ValidationError("Canonical rule files must start with a frontmatter block.");
      }

      const id = readStringField(parsed.frontmatter, "id");
      const title = readStringField(parsed.frontmatter, "title");
      const stacks = readLegacyStacks(parsed.frontmatter, id ? `rule ${id}` : `rule at ${entryPath}`);
      if (!("stack" in parsed.frontmatter) && !("alwaysOn" in parsed.frontmatter) && stacks === null) {
        return {
          rewrittenContent: content,
          frontmatterChanges: [],
          issue: createEntrySelectorIssue({ layer, kind, ...(projectId ? { projectId } : {}), path: entryPath, id, title }),
        };
      }
      if (stacks && stacks.length > 1) {
        const suggestedStack = inferStackFromLegacyPath(entryPath);
        return {
          rewrittenContent: content,
          frontmatterChanges: [],
          issue: createMultiStackIssue({
            layer,
            kind,
            ...(projectId ? { projectId } : {}),
            path: entryPath,
            id,
            title,
            stacks,
            suggestedStack,
          }),
        };
      }

      const selector = normalizeSelector(parsed.frontmatter, id ? `rule ${id}` : `rule at ${entryPath}`);
      return {
        rewrittenContent: rewriteLegacyRuleContent(content),
        frontmatterChanges: summarizeFrontmatterChanges(parsed.frontmatter, selector),
        issue: null,
      };
    }
  }

  try {
    parseCanonicalSkillDocument(content);
    return {
      rewrittenContent: content,
      frontmatterChanges: [],
      issue: null,
    };
  } catch {
    const parsed = parseFrontmatterBlock(content);
    if (!parsed) {
      throw new ValidationError("Canonical skill files must start with a frontmatter block.");
    }

  const id = readStringField(parsed.frontmatter, "id");
  const title = readStringField(parsed.frontmatter, "title");
  const stacks = readLegacyStacks(parsed.frontmatter, id ? `skill ${id}` : `skill at ${entryPath}`);
  if (!("stack" in parsed.frontmatter) && !("alwaysOn" in parsed.frontmatter) && stacks === null) {
    return {
      rewrittenContent: content,
      frontmatterChanges: [],
      issue: createEntrySelectorIssue({ layer, kind, ...(projectId ? { projectId } : {}), path: entryPath, id, title }),
    };
  }
  if (stacks && stacks.length > 1) {
    const suggestedStack = inferStackFromLegacyPath(entryPath);
    return {
      rewrittenContent: content,
      frontmatterChanges: [],
      issue: createMultiStackIssue({
        layer,
        kind,
        ...(projectId ? { projectId } : {}),
        path: entryPath,
        id,
        title,
        stacks,
        suggestedStack,
      }),
    };
  }

  const selector = normalizeSelector(parsed.frontmatter, id ? `skill ${id}` : `skill at ${entryPath}`);
  return {
    rewrittenContent: rewriteLegacySkillContent(content),
    frontmatterChanges: summarizeFrontmatterChanges(parsed.frontmatter, selector),
    issue: null,
  };
  }
};

const resolveEntryBaseDirectory = (
  repository: BankRepository,
  layer: Layer,
  kind: EntryKind,
  projectId?: string,
): string => {
  if (layer === "shared") {
    return kind === "rules" ? repository.paths.sharedRulesDirectory : repository.paths.sharedSkillsDirectory;
  }

  if (!projectId) {
    throw new ValidationError("Project id is required when migrating project-layer entries.");
  }

  return kind === "rules"
    ? repository.paths.projectRulesDirectory(projectId)
    : repository.paths.projectSkillsDirectory(projectId);
};

const listLayerContentFiles = async ({
  repository,
  layer,
  kind,
  projectId,
}: LayerMigrationOptions): Promise<string[]> => {
  const baseDirectory = resolveEntryBaseDirectory(repository, layer, kind, projectId);
  const filePaths = await listManagedFilesRecursively(repository.rootPath, baseDirectory);

  return filePaths.map((filePath) => path.relative(baseDirectory, filePath).replaceAll("\\", "/"));
};

const listProjectIdsWithContentDirectories = async (repository: BankRepository): Promise<string[]> => {
  const projectDirectories = await listManagedChildDirectories(repository.rootPath, repository.paths.projectsDirectory);

  return projectDirectories.map((directoryPath) => path.basename(directoryPath)).sort((left, right) => left.localeCompare(right));
};

const pruneEmptyDirectoryTree = async (directoryPath: string): Promise<void> => {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      await pruneEmptyDirectoryTree(path.join(directoryPath, entry.name));
    }

    const remainingEntries = await fs.readdir(directoryPath);
    if (remainingEntries.length === 0) {
      await fs.rmdir(directoryPath);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTEMPTY") {
      return;
    }

    throw error;
  }
};

const pruneLegacyNamespaces = async (
  repository: BankRepository,
  layer: Layer,
  kind: EntryKind,
  projectId?: string,
): Promise<void> => {
  const baseDirectory = resolveEntryBaseDirectory(repository, layer, kind, projectId);
  const legacyDirectories =
    kind === "rules"
      ? ["core", "topics", "providers", "stacks"]
      : ["shared", "project", "stacks"];

  for (const legacyDirectory of legacyDirectories) {
    await pruneEmptyDirectoryTree(path.join(baseDirectory, legacyDirectory));
  }
};

const deleteBankSupportFiles = async (repository: BankRepository): Promise<void> => {
  const filePaths = await listManagedFilesRecursively(repository.rootPath, repository.rootPath);

  for (const filePath of filePaths) {
    if (!BANK_SUPPORT_FILE_BASENAMES.has(path.basename(filePath))) {
      continue;
    }

    await deleteManagedFile(repository.rootPath, filePath);
  }
};

const mergePreflight = (target: BankContentMigrationPreflight, source: BankContentMigrationPreflight): void => {
  target.autoMigrations.push(...source.autoMigrations);
  target.requiresResolution.push(...source.requiresResolution);
};

const pushAutoMigration = (
  preflight: BankContentMigrationPreflight,
  migration: Omit<BankContentMigrationAutoMigration, "safeBeforeResolution">,
): void => {
  preflight.autoMigrations.push({
    ...migration,
    safeBeforeResolution: isSafeBeforeResolutionMigration(migration),
  });
};

const inspectLayerMigration = async ({ repository, layer, kind, projectId }: LayerMigrationOptions): Promise<BankContentMigrationPreflight> => {
  const preflight = createEmptyPreflight();
  const entryPaths = await listLayerContentFiles({ repository, layer, kind, ...(projectId ? { projectId } : {}) });
  const desiredContentByPath = new Map<string, string>();
  const sourcePathsByDesiredPath = new Map<string, string[]>();

  for (const currentPath of entryPaths) {
    if (isAutoRemovableSupportFile(currentPath)) {
      pushAutoMigration(preflight, {
        scope: layer,
        kind,
        projectId: projectId ?? null,
        fromPath: currentPath,
        toPath: "",
        pathChange: hasHiddenPathSegment(currentPath)
          ? `Remove hidden support file ${currentPath}; dotfiles are not AI Guidance Bank entries.`
          : isLegacyNamespacedDocumentationPath(kind, currentPath)
            ? `Remove legacy namespace documentation file ${currentPath}; namespace folders no longer define matching behavior.`
            : `Remove documentation file ${currentPath}; README files are not AI Guidance Bank entries.`,
        frontmatterChanges: [],
      });
      continue;
    }

    if (!isEntryFile(kind, currentPath)) {
      preflight.requiresResolution.push(
        createUnsupportedEntryFileIssue({
          layer,
          kind,
          ...(projectId ? { projectId } : {}),
          path: currentPath,
        }),
      );
      continue;
    }

    const currentContent = await repository.readLayerEntry(layer, kind, currentPath, projectId);
    const desiredPath = normalizeLegacyEntryPath(kind, currentPath);
    const analysis = analyzeEntryContentForPreflight({
      layer,
      kind,
      ...(projectId ? { projectId } : {}),
      path: currentPath,
      content: currentContent,
    });

    if (analysis.issue) {
      preflight.requiresResolution.push(analysis.issue);
      continue;
    }

    const sourcePaths = sourcePathsByDesiredPath.get(desiredPath) ?? [];
    sourcePaths.push(currentPath);
    sourcePathsByDesiredPath.set(desiredPath, sourcePaths);

    const existingDesiredContent = desiredContentByPath.get(desiredPath);
    if (existingDesiredContent !== undefined && existingDesiredContent !== analysis.rewrittenContent) {
      preflight.requiresResolution.push(
        createPathCollisionIssue({
          layer,
          kind,
          ...(projectId ? { projectId } : {}),
          desiredPath,
          collidingPaths: sourcePaths,
        }),
      );
      continue;
    }

    desiredContentByPath.set(desiredPath, analysis.rewrittenContent);

    const pathChange =
      currentPath === desiredPath
        ? null
        : `Move ${kind.slice(0, -1)} entry from legacy path ${currentPath} to current path ${desiredPath}. Paths are organizational only; stack matching comes from frontmatter.`;
    if (pathChange !== null || analysis.frontmatterChanges.length > 0) {
      pushAutoMigration(preflight, {
        scope: layer,
        kind,
        projectId: projectId ?? null,
        fromPath: currentPath,
        toPath: desiredPath,
        pathChange,
        frontmatterChanges: analysis.frontmatterChanges,
      });
    }
  }

  return preflight;
};

const migrateLayerEntries = async ({ repository, layer, kind, projectId }: LayerMigrationOptions): Promise<void> => {
  const entryPaths = await listLayerContentFiles({ repository, layer, kind, ...(projectId ? { projectId } : {}) });
  const currentEntries = new Map<string, string>();

  for (const currentPath of entryPaths) {
    if (isAutoRemovableSupportFile(currentPath)) {
      continue;
    }

    if (!isEntryFile(kind, currentPath)) {
      throw new ValidationError(
        `Cannot auto-upgrade unsupported ${layer}/${kind} file ${currentPath}. Resolve or remove it before upgrading.`,
      );
    }

    currentEntries.set(currentPath, await repository.readLayerEntry(layer, kind, currentPath, projectId));
  }

  const desiredEntries = new Map<string, string>();
  for (const [currentPath, currentContent] of currentEntries) {
    const desiredPath = normalizeLegacyEntryPath(kind, currentPath);
    const desiredContent = rewriteLegacyEntryContent(kind, currentContent);
    const existingDesiredContent = desiredEntries.get(desiredPath);

    if (existingDesiredContent !== undefined && existingDesiredContent !== desiredContent) {
      throw new ValidationError(
        `Upgrade collision for ${layer}/${kind}: multiple entries resolve to ${desiredPath}. Resolve the duplicates manually before upgrading.`,
      );
    }

    desiredEntries.set(desiredPath, desiredContent);
  }

  const baseDirectory = resolveEntryBaseDirectory(repository, layer, kind, projectId);

  for (const currentPath of entryPaths) {
    if (!desiredEntries.has(currentPath)) {
      await deleteManagedFile(repository.rootPath, path.join(baseDirectory, currentPath));
    }
  }

  for (const [desiredPath, desiredContent] of desiredEntries) {
    if (currentEntries.get(desiredPath) === desiredContent) {
      continue;
    }

    await writeManagedTextFile(repository.rootPath, path.join(baseDirectory, desiredPath), desiredContent);
  }

  await pruneLegacyNamespaces(repository, layer, kind, projectId);
};

const applySafeBeforeResolutionLayerMigrations = async ({
  repository,
  layer,
  kind,
  projectId,
}: LayerMigrationOptions): Promise<void> => {
  const entryPaths = await listLayerContentFiles({ repository, layer, kind, ...(projectId ? { projectId } : {}) });
  const baseDirectory = resolveEntryBaseDirectory(repository, layer, kind, projectId);
  const candidateMoves = new Map<string, Array<{ currentPath: string; content: string }>>();

  for (const currentPath of entryPaths) {
    if (isAutoRemovableSupportFile(currentPath) || !isEntryFile(kind, currentPath)) {
      continue;
    }

    const desiredPath = normalizeLegacyEntryPath(kind, currentPath);
    if (desiredPath === currentPath) {
      continue;
    }

    const candidates = candidateMoves.get(desiredPath) ?? [];
    candidates.push({
      currentPath,
      content: await repository.readLayerEntry(layer, kind, currentPath, projectId),
    });
    candidateMoves.set(desiredPath, candidates);
  }

  const moveEntries: Array<{ currentPath: string; desiredPath: string; content: string }> = [];
  for (const [desiredPath, candidates] of candidateMoves) {
    if (candidates.length !== 1) {
      continue;
    }

    const candidate = candidates[0]!;
    moveEntries.push({
      currentPath: candidate.currentPath,
      desiredPath,
      content: candidate.content,
    });
  }

  for (const currentPath of entryPaths) {
    if (isAutoRemovableSupportFile(currentPath)) {
      await deleteManagedFile(repository.rootPath, path.join(baseDirectory, currentPath));
    }
  }

  for (const moveEntry of moveEntries) {
    await deleteManagedFile(repository.rootPath, path.join(baseDirectory, moveEntry.currentPath));
  }

  for (const moveEntry of moveEntries) {
    await writeManagedTextFile(repository.rootPath, path.join(baseDirectory, moveEntry.desiredPath), moveEntry.content);
  }

  await pruneLegacyNamespaces(repository, layer, kind, projectId);
};

export const applyV2ToV3SafeContentMigrations = async (repository: BankRepository): Promise<void> => {
  await deleteBankSupportFiles(repository);

  await applySafeBeforeResolutionLayerMigrations({ repository, layer: "shared", kind: "rules" });
  await applySafeBeforeResolutionLayerMigrations({ repository, layer: "shared", kind: "skills" });

  const projectIds = await listProjectIdsWithContentDirectories(repository);
  for (const projectId of projectIds) {
    await applySafeBeforeResolutionLayerMigrations({
      repository,
      layer: "project",
      kind: "rules",
      projectId,
    });
    await applySafeBeforeResolutionLayerMigrations({
      repository,
      layer: "project",
      kind: "skills",
      projectId,
    });
  }
};

export const inspectV2ToV3ContentMigration = async (repository: BankRepository): Promise<BankContentMigrationPreflight> => {
  const preflight = createEmptyPreflight();

  mergePreflight(preflight, await inspectLayerMigration({ repository, layer: "shared", kind: "rules" }));
  mergePreflight(preflight, await inspectLayerMigration({ repository, layer: "shared", kind: "skills" }));

  const projectIds = await listProjectIdsWithContentDirectories(repository);
  for (const projectId of projectIds) {
    mergePreflight(
      preflight,
      await inspectLayerMigration({
        repository,
        layer: "project",
        kind: "rules",
        projectId,
      }),
    );
    mergePreflight(
      preflight,
      await inspectLayerMigration({
        repository,
        layer: "project",
        kind: "skills",
        projectId,
      }),
    );
  }

  return preflight;
};

export const applyV2ToV3ContentMigration = async (repository: BankRepository): Promise<void> => {
  await migrateLayerEntries({ repository, layer: "shared", kind: "rules" });
  await migrateLayerEntries({ repository, layer: "shared", kind: "skills" });

  const projectIds = await listProjectIdsWithContentDirectories(repository);
  for (const projectId of projectIds) {
    await migrateLayerEntries({
      repository,
      layer: "project",
      kind: "rules",
      projectId,
    });
    await migrateLayerEntries({
      repository,
      layer: "project",
      kind: "skills",
      projectId,
    });
  }
};
