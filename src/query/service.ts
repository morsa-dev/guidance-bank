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
        if (args.kind === "rules") {
          const document = parseCanonicalRuleDocument(content);

          return {
            scope: args.scope,
            kind: args.kind,
            path: normalizeEntryDisplayPath(args.kind, entry.path),
            filePath: entry.path.replaceAll("\\", "/"),
            id: document.frontmatter.id,
            title: document.frontmatter.title,
            stacks: document.frontmatter.stack ? [document.frontmatter.stack] : [],
            topics: [...document.frontmatter.topics],
            description: null,
            bodyPreview: summarizeBody(document.body),
          } satisfies GuidanceBankEntrySummary;
        }

        const document = parseCanonicalSkillDocument(content);

        return {
          scope: args.scope,
          kind: args.kind,
          path: normalizeEntryDisplayPath(args.kind, entry.path),
          filePath: entry.path.replaceAll("\\", "/"),
          id: document.frontmatter.id,
          title: document.frontmatter.title,
          stacks: document.frontmatter.stack ? [document.frontmatter.stack] : [],
          topics: [...document.frontmatter.topics],
          description: document.frontmatter.description,
          bodyPreview: summarizeBody(document.body),
        } satisfies GuidanceBankEntrySummary;
      }),
    );
  }

  async readEntry(args: GuidanceBankReadEntryArgs): Promise<GuidanceBankEntryDetail> {
    const projectId = await this.resolveProjectId(args.scope, args.projectPath);
    if (args.scope === "project" && !projectId) {
      throw new Error(`No project AI Guidance Bank exists for ${path.resolve(args.projectPath ?? process.cwd())}.`);
    }

    const content = await this.repository.readLayerEntry(args.scope, args.kind, args.path, projectId);
    if (args.kind === "rules") {
      const document = parseCanonicalRuleDocument(content);

      return {
        scope: args.scope,
        kind: args.kind,
        path: normalizeEntryDisplayPath(args.kind, args.path),
        filePath: args.path.replaceAll("\\", "/"),
        id: document.frontmatter.id,
        title: document.frontmatter.title,
        stacks: document.frontmatter.stack ? [document.frontmatter.stack] : [],
        topics: [...document.frontmatter.topics],
        description: null,
        bodyPreview: summarizeBody(document.body),
        content,
        body: document.body,
      };
    }

    const document = parseCanonicalSkillDocument(content);

    return {
      scope: args.scope,
      kind: args.kind,
      path: normalizeEntryDisplayPath(args.kind, args.path),
      filePath: args.path.replaceAll("\\", "/"),
      id: document.frontmatter.id,
      title: document.frontmatter.title,
      stacks: document.frontmatter.stack ? [document.frontmatter.stack] : [],
      topics: [...document.frontmatter.topics],
      description: document.frontmatter.description,
      bodyPreview: summarizeBody(document.body),
      content,
      body: document.body,
    };
  }
}

export const createGuidanceBankQueryService = (options?: { bankRoot?: string }): GuidanceBankQueryService =>
  new GuidanceBankQueryService(options?.bankRoot);
