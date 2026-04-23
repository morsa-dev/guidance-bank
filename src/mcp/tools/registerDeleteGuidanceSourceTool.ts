import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { discoverExistingGuidance } from "../../core/projects/discoverExistingGuidance.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
import { MCP_TOOL_NAMES } from "../toolNames.js";
import { AbsoluteProjectPathSchema, SessionRefSchema } from "./sharedSchemas.js";
import { writeToolAuditEvent } from "./auditUtils.js";
import { buildInvalidToolArgsResult, buildStructuredToolResult } from "./entryMutationHelpers.js";
import { resolveAuditSessionRef } from "./sessionRefResolver.js";

const DeleteGuidanceSourceArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: SessionRefSchema,
    sourcePath: z
      .string()
      .trim()
      .min(1)
      .describe("Absolute path to a discovered repository-local, provider-project, or provider-global guidance source."),
  })
  .strict();

const snapshotGuidanceFile = async (
  sourceRootPath: string,
  filePath: string,
): Promise<{ relativePath: string; sha256: string; byteCount: number; contentBase64: string }> => {
  const stats = await fs.lstat(filePath);

  if (stats.isSymbolicLink()) {
    throw new ValidationError(`Guidance source cannot contain symbolic links: ${filePath}`);
  }

  if (!stats.isFile()) {
    throw new ValidationError(`Unsupported guidance source path type: ${filePath}`);
  }

  const content = await fs.readFile(filePath);
  const relativePath = path.relative(sourceRootPath, filePath);

  return {
    relativePath: relativePath.length === 0 ? path.basename(filePath) : relativePath,
    sha256: createHash("sha256").update(content).digest("hex"),
    byteCount: content.byteLength,
    contentBase64: content.toString("base64"),
  };
};

const snapshotGuidanceDirectory = async (
  sourceRootPath: string,
  directoryPath: string,
): Promise<Array<{ relativePath: string; sha256: string; byteCount: number; contentBase64: string }>> => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const snapshots: Array<{ relativePath: string; sha256: string; byteCount: number; contentBase64: string }> = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isSymbolicLink()) {
      throw new ValidationError(`Guidance source cannot contain symbolic links: ${entryPath}`);
    }

    if (entry.isDirectory()) {
      snapshots.push(...(await snapshotGuidanceDirectory(sourceRootPath, entryPath)));
      continue;
    }

    if (entry.isFile()) {
      snapshots.push(await snapshotGuidanceFile(sourceRootPath, entryPath));
      continue;
    }

    throw new ValidationError(`Unsupported guidance source path type: ${entryPath}`);
  }

  return snapshots;
};

const snapshotGuidanceSource = async (
  sourcePath: string,
): Promise<Array<{ relativePath: string; sha256: string; byteCount: number; contentBase64: string }>> => {
  const stats = await fs.lstat(sourcePath);

  if (stats.isSymbolicLink()) {
    throw new ValidationError(`Guidance source cannot be a symbolic link: ${sourcePath}`);
  }

  if (stats.isFile()) {
    return [await snapshotGuidanceFile(sourcePath, sourcePath)];
  }

  if (stats.isDirectory()) {
    return snapshotGuidanceDirectory(sourcePath, sourcePath);
  }

  throw new ValidationError(`Unsupported guidance source path type: ${sourcePath}`);
};

const deleteGuidancePath = async (targetPath: string): Promise<"deleted" | "not_found"> => {
  try {
    const stats = await fs.lstat(targetPath);

    if (stats.isSymbolicLink()) {
      throw new ValidationError(`Guidance source cannot be a symbolic link: ${targetPath}`);
    }

    if (stats.isDirectory()) {
      await fs.rm(targetPath, { recursive: true, force: false });
      return "deleted";
    }

    if (stats.isFile()) {
      await fs.unlink(targetPath);
      return "deleted";
    }

    throw new ValidationError(`Unsupported guidance source path type: ${targetPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "not_found";
    }

    throw error;
  }
};

const resolveComparablePath = async (targetPath: string): Promise<string> => {
  try {
    return await fs.realpath(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return path.resolve(targetPath);
    }

    throw error;
  }
};

export const registerDeleteGuidanceSourceTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    MCP_TOOL_NAMES.deleteGuidanceSource,
    {
      title: "Delete External Guidance Source",
      description:
        "Delete a discovered repository-local, provider-project, or provider-global guidance source after the user explicitly chose import_to_bank and the source was fully replaced by canonical bank entries.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
      inputSchema: {
        projectPath: AbsoluteProjectPathSchema,
        sessionRef: SessionRefSchema,
        sourcePath: z
          .string()
          .trim()
          .min(1)
          .describe("Absolute path to a discovered repository-local, provider-project, or provider-global guidance source."),
      },
      outputSchema: {
        status: z.enum(["deleted", "not_found"]),
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        sourcePath: z.string(),
        relativePath: z.string(),
        kind: z.string(),
        scope: z.enum(["repository-local", "provider-project", "provider-global"]),
        provider: z.enum(["codex", "cursor", "claude"]).nullable(),
      },
    },
    async (args) => {
      const parsedArgs = DeleteGuidanceSourceArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return buildInvalidToolArgsResult(MCP_TOOL_NAMES.deleteGuidanceSource, parsedArgs.error);
      }

      const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
      const discoveredSources = await discoverExistingGuidance(identity.projectPath);
      const targetPath = path.resolve(parsedArgs.data.sourcePath);
      const comparableTargetPath = await resolveComparablePath(targetPath);
      const matchingSource = await (async () => {
        for (const candidate of discoveredSources) {
          if ((await resolveComparablePath(candidate.path)) === comparableTargetPath) {
            return candidate;
          }
        }

        return null;
      })();

      if (!matchingSource) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Guidance source is not currently discoverable for this project: ${targetPath}`,
            },
          ],
        };
      }

      const sourceFiles = await snapshotGuidanceSource(targetPath);
      await options.auditLogger.writeGuidanceSourceVersion({
        sessionRef: resolveAuditSessionRef(parsedArgs.data.sessionRef),
        tool: MCP_TOOL_NAMES.deleteGuidanceSource,
        action: "delete_snapshot",
        projectId: identity.projectId,
        projectPath: identity.projectPath,
        sourcePath: targetPath,
        relativePath: matchingSource.relativePath,
        kind: matchingSource.kind,
        scope: matchingSource.scope,
        sourceProvider: matchingSource.provider,
        entryType: matchingSource.entryType,
        files: sourceFiles,
      });

      const status = await deleteGuidancePath(targetPath);
      await writeToolAuditEvent({
        auditLogger: options.auditLogger,
        sessionRef: parsedArgs.data.sessionRef,
        tool: MCP_TOOL_NAMES.deleteGuidanceSource,
        action: "delete_guidance",
        projectId: identity.projectId,
        projectPath: identity.projectPath,
        details: {
          status,
          sourcePath: targetPath,
          relativePath: matchingSource.relativePath,
          scope: matchingSource.scope,
          provider: matchingSource.provider,
        },
      });

      return buildStructuredToolResult({
        status,
        projectId: identity.projectId,
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        sourcePath: targetPath,
        relativePath: matchingSource.relativePath,
        kind: matchingSource.kind,
        scope: matchingSource.scope,
        provider: matchingSource.provider,
      });
    },
  );
};
