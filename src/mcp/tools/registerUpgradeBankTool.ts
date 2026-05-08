import { z } from "zod";

import { UpgradeService, type UpgradeBankResult } from "../../core/upgrade/upgradeService.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { writeToolAuditEvent } from "./auditUtils.js";

type CompactAutoMigrationSummary = {
  scope: "shared" | "project";
  kind: "rules" | "skills";
  projectId: string | null;
  count: number;
};

type CompactResolutionGroup = {
  reason: UpgradeBankResult["requiresResolution"][number]["reason"];
  scope: "shared" | "project";
  kind: "rules" | "skills";
  projectId: string | null;
  paths: string[];
  collisions?: Array<{ path: string; collidingPaths: string[] }>;
};

const UpgradeBankArgsSchema = z.object({}).strict();

const summarizeAutoMigrations = (result: UpgradeBankResult): CompactAutoMigrationSummary[] => {
  const counts = new Map<string, CompactAutoMigrationSummary>();

  for (const migration of result.autoMigrations) {
    const key = `${migration.scope}:${migration.kind}:${migration.projectId ?? ""}`;
    const summary =
      counts.get(key) ??
      ({
        scope: migration.scope,
        kind: migration.kind,
        projectId: migration.projectId,
        count: 0,
      } satisfies CompactAutoMigrationSummary);

    summary.count += 1;
    counts.set(key, summary);
  }

  return [...counts.values()];
};

const groupResolutionIssues = (result: UpgradeBankResult): CompactResolutionGroup[] => {
  const groups = new Map<string, CompactResolutionGroup>();

  for (const issue of result.requiresResolution) {
    const key = `${issue.reason}:${issue.scope}:${issue.kind}:${issue.projectId ?? ""}`;
    const group =
      groups.get(key) ??
      ({
        reason: issue.reason,
        scope: issue.scope,
        kind: issue.kind,
        projectId: issue.projectId,
        paths: [],
      } satisfies CompactResolutionGroup);

    group.paths.push(issue.path);
    if (issue.collidingPaths) {
      const collisions = group.collisions ?? [];
      collisions.push({ path: issue.path, collidingPaths: issue.collidingPaths });
      group.collisions = collisions;
    }

    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    paths: group.paths.sort((left, right) => left.localeCompare(right)),
  }));
};

const compactUpgradeResult = (result: UpgradeBankResult) => ({
  status: result.status,
  bankRoot: result.bankRoot,
  sourceRoot: result.sourceRoot,
  migratedBankRoot: result.migratedBankRoot,
  previousStorageVersion: result.previousStorageVersion,
  storageVersion: result.storageVersion,
  enabledProviders: result.enabledProviders,
  autoMigrationCount: result.autoMigrations.length,
  autoMigrationSummary: summarizeAutoMigrations(result),
  requiresResolutionCount: result.requiresResolution.length,
  resolutionGroups: groupResolutionIssues(result),
  ...(result.status === "needs_resolution"
    ? {
        resolutionInstructions: [
          "Resolve every resolutionGroups path by reading the listed file and editing only the frontmatter selector.",
          "Canonical entries must use exactly one selector: `stack: <canonical-id>` or `alwaysOn: true`.",
          "Prefer a concrete `stack` selector when the path, legacy stacks, title, or body points to one technology.",
          "Use `alwaysOn: true` only for genuinely global guidance. Do not use alwaysOn as a fallback for ambiguity.",
          "Never keep `stacks`, never omit the selector, and never use both `stack` and `alwaysOn`.",
          "After saving all fixes, call `upgrade_bank` again.",
        ],
      }
    : {}),
});

const renderUpgradeToolText = (result: ReturnType<typeof compactUpgradeResult>): string => {
  if (result.status === "already_current") {
    return `AI Guidance Bank is already current at storageVersion ${result.storageVersion}.`;
  }

  if (result.status === "upgraded") {
    return `AI Guidance Bank upgraded to storageVersion ${result.storageVersion}. Applied ${result.autoMigrationCount} automatic migration${result.autoMigrationCount === 1 ? "" : "s"}.`;
  }

  return [
    `AI Guidance Bank upgrade needs ${result.requiresResolutionCount} explicit resolution${result.requiresResolutionCount === 1 ? "" : "s"}.`,
    `${result.autoMigrationCount} automatic migration${result.autoMigrationCount === 1 ? "" : "s"} are pending and will apply after resolutions are fixed.`,
    "Use structuredContent.resolutionGroups as the work list. Read each file, prefer a concrete stack selector, then call upgrade_bank again.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
};

export const registerUpgradeBankTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    MCP_TOOL_NAMES.upgradeBank,
    {
      title: "Upgrade AI Guidance Bank",
      description:
        "Upgrade AI Guidance Bank to the current storage version. If resolve_context returns requiredAction === \"upgrade_bank\", call this before normal repository work. This migrates the bank root when needed, removes legacy MCP registrations, and reapplies current integrations.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {},
      outputSchema: {
        status: z.enum(["upgraded", "already_current", "needs_resolution"]),
        bankRoot: z.string(),
        sourceRoot: z.string(),
        migratedBankRoot: z.boolean(),
        previousStorageVersion: z.number().int().positive(),
        storageVersion: z.number().int().positive(),
        enabledProviders: z.array(z.string()),
        autoMigrationCount: z.number().int().nonnegative(),
        autoMigrationSummary: z.array(
          z.object({
            scope: z.enum(["shared", "project"]),
            kind: z.enum(["rules", "skills"]),
            projectId: z.string().nullable(),
            count: z.number().int().nonnegative(),
          }),
        ),
        requiresResolutionCount: z.number().int().nonnegative(),
        resolutionGroups: z.array(
          z.object({
            reason: z.enum([
              "multi_stack_frontmatter",
              "entry_selector_resolution",
              "path_collision",
              "unsupported_entry_file",
            ]),
            scope: z.enum(["shared", "project"]),
            kind: z.enum(["rules", "skills"]),
            projectId: z.string().nullable(),
            paths: z.array(z.string()),
            collisions: z
              .array(
                z.object({
                  path: z.string(),
                  collidingPaths: z.array(z.string()),
                }),
              )
              .optional(),
          }),
        ),
        resolutionInstructions: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const parsedArgs = UpgradeBankArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid arguments for tool ${MCP_TOOL_NAMES.upgradeBank}: ${z.prettifyError(parsedArgs.error)}`,
            },
          ],
        };
      }

      try {
        const providerSession = await options.providerSessionResolver.resolve();
        const upgradeService = new UpgradeService();
        const result = await upgradeService.run({
          bankRoot: options.repository.rootPath,
        });

        await writeToolAuditEvent({
          auditLogger: options.auditLogger,
          providerSession,
          tool: MCP_TOOL_NAMES.upgradeBank,
          action: "upgrade",
          projectId: "bank",
          projectPath: result.bankRoot,
          details: {
            sourceRoot: result.sourceRoot,
            migratedBankRoot: result.migratedBankRoot,
            previousStorageVersion: result.previousStorageVersion,
            storageVersion: result.storageVersion,
            enabledProviders: result.enabledProviders,
            requiresResolution: result.requiresResolution.length,
            autoMigrations: result.autoMigrations.length,
          },
        });

        const compactResult = compactUpgradeResult(result);

        return {
          content: [
            {
              type: "text",
              text: renderUpgradeToolText(compactResult),
            },
          ],
          structuredContent: compactResult,
        };
      } catch (error) {
        if (error instanceof ValidationError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error.message,
              },
            ],
          };
        }

        throw error;
      }
    },
  );
};
