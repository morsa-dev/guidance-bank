import path from "node:path";

import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../core/bank/canonicalEntry.js";
import type { EntryKind, EntryScope } from "../core/bank/types.js";
import { resolveProjectIdentity } from "../core/projects/identity.js";
import { StatsService } from "../core/stats/statsService.js";
import { resolveBankRoot } from "../shared/paths.js";
import { BankRepository } from "../storage/bankRepository.js";
import type {
  GuidanceBankBootstrap,
  GuidanceBankEntryDetail,
  GuidanceBankEntrySummary,
  GuidanceBankListEntriesArgs,
  GuidanceBankReadEntryArgs,
  GuidanceBankSelectedProject,
  GuidanceBankWriteEntryArgs,
  GuidanceBankWriteEntryResult,
} from "./types.js";

const isDocumentationEntry = (entryPath: string): boolean => {
  const normalizedEntryPath = entryPath.replaceAll("\\", "/").toLowerCase();
  return normalizedEntryPath === "readme.md" || normalizedEntryPath.endsWith("/readme.md");
};

const normalizeEntryDisplayPath = (kind: EntryKind, entryPath: string): string => {
  const normalizedPath = entryPath.replaceAll("\\", "/");
  return kind === "skills" && normalizedPath.endsWith("/SKILL.md")
    ? normalizedPath.slice(0, -"/SKILL.md".length)
    : normalizedPath;
};

const summarizeBody = (body: string): string => {
  const normalized = body.replace(/\s+/gu, " ").trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
};

const comparePaths = (left: { path: string }, right: { path: string }): number => left.path.localeCompare(right.path);

type ParsedEntryDocument = {
  id: string;
  title: string;
  stack: string | null;
  topics: string[];
  description: string | null;
  body: string;
};

const parseEntryDocument = (kind: EntryKind, content: string): ParsedEntryDocument => {
  if (kind === "rules") {
    const document = parseCanonicalRuleDocument(content);

    return {
      id: document.frontmatter.id,
      title: document.frontmatter.title,
      stack: document.frontmatter.stack ?? null,
      topics: [...document.frontmatter.topics],
      description: null,
      body: document.body,
    };
  }

  const document = parseCanonicalSkillDocument(content);

  return {
    id: document.frontmatter.id,
    title: document.frontmatter.title,
    stack: document.frontmatter.stack ?? null,
    topics: [...document.frontmatter.topics],
    description: document.frontmatter.description,
    body: document.body,
  };
};

const buildEntrySummary = ({
  scope,
  kind,
  entryPath,
  document,
}: {
  scope: EntryScope;
  kind: EntryKind;
  entryPath: string;
  document: ParsedEntryDocument;
}): GuidanceBankEntrySummary => ({
  scope,
  kind,
  path: normalizeEntryDisplayPath(kind, entryPath),
  filePath: entryPath.replaceAll("\\", "/"),
  id: document.id,
  title: document.title,
  stacks: document.stack ? [document.stack] : [],
  topics: [...document.topics],
  description: document.description,
  bodyPreview: summarizeBody(document.body),
});

export class GuidanceBankQueryService {
  readonly bankRoot: string;
  private readonly repository: BankRepository;
  private readonly statsService: StatsService;

  constructor(bankRoot?: string) {
    this.bankRoot = resolveBankRoot(bankRoot);
    this.repository = new BankRepository(this.bankRoot);
    this.statsService = new StatsService(this.bankRoot);
  }

  private async readProjectSelection(projectPath?: string): Promise<GuidanceBankSelectedProject> {
    if (!projectPath) {
      return {
        status: "none",
        projectPath: null,
      };
    }

    const resolvedProjectPath = path.resolve(projectPath);
    const projectIdentity = resolveProjectIdentity(resolvedProjectPath);
    const manifest = await this.repository.readProjectManifestOptional(projectIdentity.projectId);

    if (manifest === null) {
      return {
        status: "project_missing",
        projectPath: resolvedProjectPath,
      };
    }

    const projectStats = await this.statsService.collect({ projectPath: manifest.projectPath });
    const project = projectStats.project;

    if (!project) {
      return {
        status: "project_missing",
        projectPath: resolvedProjectPath,
      };
    }

    return {
      status: "ready",
      projectPath: project.projectPath,
      projectId: project.projectId,
      projectName: project.projectName,
      detectedStacks: project.detectedStacks,
      creationState: project.creationState,
      updatedAt: project.updatedAt,
      entries: project.entries,
    };
  }

  private async resolveProjectId(scope: EntryScope, projectPath?: string): Promise<string | undefined> {
    if (scope !== "project" || !projectPath) {
      return undefined;
    }

    const projectIdentity = resolveProjectIdentity(projectPath);
    const manifest = await this.repository.readProjectManifestOptional(projectIdentity.projectId);
    return manifest?.projectId;
  }

  async getBootstrap(options?: { projectPath?: string }): Promise<GuidanceBankBootstrap> {
    const projectPath = options?.projectPath;
    const stats = await this.statsService.collect();
    const projectManifests = (await this.repository.listProjectManifests())
      .map((manifest) => ({
        projectId: manifest.projectId,
        projectName: manifest.projectName,
        projectPath: manifest.projectPath,
        detectedStacks: [...manifest.detectedStacks],
        updatedAt: manifest.updatedAt,
      }))
      .sort((left, right) => left.projectName.localeCompare(right.projectName) || left.projectPath.localeCompare(right.projectPath));

    return {
      bankRoot: stats.bankRoot,
      defaultProjectPath: projectPath ? path.resolve(projectPath) : null,
      manifest: stats.manifest,
      sharedEntries: stats.sharedEntries,
      projectSummary: stats.projects,
      availableProjects: projectManifests,
      selectedProject: await this.readProjectSelection(projectPath),
    };
  }

  async listEntries(args: GuidanceBankListEntriesArgs): Promise<GuidanceBankEntrySummary[]> {
    const projectId = await this.resolveProjectId(args.scope, args.projectPath);
    if (args.scope === "project" && !projectId) {
      return [];
    }

    const entries = await this.repository.listLayerEntries(args.scope, args.kind, projectId);
    const normalizedEntries = entries.filter((entry) => !isDocumentationEntry(entry.path)).sort(comparePaths);

    return Promise.all(
      normalizedEntries.map(async (entry) => {
        const content = await this.repository.readLayerEntry(args.scope, args.kind, entry.path, projectId);
        const document = parseEntryDocument(args.kind, content);

        return buildEntrySummary({
          scope: args.scope,
          kind: args.kind,
          entryPath: entry.path,
          document,
        });
      }),
    );
  }

  async readEntry(args: GuidanceBankReadEntryArgs): Promise<GuidanceBankEntryDetail> {
    const projectId = await this.resolveProjectId(args.scope, args.projectPath);
    if (args.scope === "project" && !projectId) {
      throw new Error(`No project AI Guidance Bank exists for ${path.resolve(args.projectPath ?? process.cwd())}.`);
    }

    const content = await this.repository.readLayerEntry(args.scope, args.kind, args.path, projectId);
    const document = parseEntryDocument(args.kind, content);

    return {
      ...buildEntrySummary({
        scope: args.scope,
        kind: args.kind,
        entryPath: args.path,
        document,
      }),
      content,
      body: document.body,
    };
  }

  async writeEntry(args: GuidanceBankWriteEntryArgs): Promise<GuidanceBankWriteEntryResult> {
    const projectId = await this.resolveProjectId(args.scope, args.projectPath);
    if (args.scope === "project" && !projectId) {
      throw new Error(`No project AI Guidance Bank exists for ${path.resolve(args.projectPath ?? process.cwd())}.`);
    }

    if (args.kind === "rules") {
      const result = await this.repository.upsertRule(args.scope, args.path, args.content, projectId);
      const entry = await this.readEntry({ ...args, path: result.path });

      return {
        status: result.status,
        entry,
      };
    }

    const result = await this.repository.upsertSkill(args.scope, args.path, args.content, projectId);
    const entry = await this.readEntry({ ...args, path: result.filePath });

    return {
      status: result.status,
      entry,
    };
  }
}

export const createGuidanceBankQueryService = (options?: { bankRoot?: string }): GuidanceBankQueryService =>
  new GuidanceBankQueryService(options?.bankRoot);
