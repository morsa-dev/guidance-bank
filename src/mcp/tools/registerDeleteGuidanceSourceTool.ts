import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { discoverExistingGuidance } from "../../core/projects/discoverExistingGuidance.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import { ValidationError } from "../../shared/errors.js";
import type { ToolRegistrar } from "../registerTools.js";
import { AbsoluteProjectPathSchema, SessionRefSchema } from "./sharedSchemas.js";
import { writeToolAuditEvent } from "./auditUtils.js";
import { buildInvalidToolArgsResult, buildStructuredToolResult } from "./entryMutationHelpers.js";

const DeleteGuidanceSourceArgsSchema = z
  .object({
    projectPath: AbsoluteProjectPathSchema,
    sessionRef: SessionRefSchema,
    sourcePath: z
      .string()
      .trim()
      .min(1)
      .describe("Absolute path to a discovered repository-local or provider-project guidance source."),
  })
  .strict();

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

export const registerDeleteGuidanceSourceTool: ToolRegistrar = (server, options) => {
  server.registerTool(
    "delete_guidance_source",
    {
      title: "Delete External Guidance Source",
      description:
        "Delete a discovered repository-local or provider-project guidance source after the user explicitly chose a move-to-Memory-Bank strategy.",
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
          .describe("Absolute path to a discovered repository-local or provider-project guidance source."),
      },
      outputSchema: {
        status: z.enum(["deleted", "not_found"]),
        projectId: z.string(),
        projectName: z.string(),
        projectPath: z.string(),
        sourcePath: z.string(),
        relativePath: z.string(),
        kind: z.string(),
        scope: z.enum(["repository-local", "provider-project"]),
        provider: z.enum(["codex", "cursor", "claude"]).nullable(),
      },
    },
    async (args) => {
      const parsedArgs = DeleteGuidanceSourceArgsSchema.safeParse(args);
      if (!parsedArgs.success) {
        return buildInvalidToolArgsResult("delete_guidance_source", parsedArgs.error);
      }

      const identity = resolveProjectIdentity(parsedArgs.data.projectPath);
      const discoveredSources = await discoverExistingGuidance(identity.projectPath);
      const targetPath = path.resolve(parsedArgs.data.sourcePath);
      const source = discoveredSources.find((candidate) => path.resolve(candidate.path) === targetPath);

      if (!source) {
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

      const status = await deleteGuidancePath(targetPath);
      await writeToolAuditEvent({
        auditLogger: options.auditLogger,
        sessionRef: parsedArgs.data.sessionRef,
        tool: "delete_guidance_source",
        action: "delete_guidance",
        projectId: identity.projectId,
        projectPath: identity.projectPath,
        details: {
          status,
          sourcePath: targetPath,
          relativePath: source.relativePath,
          scope: source.scope,
          provider: source.provider,
        },
      });

      return buildStructuredToolResult({
        status,
        projectId: identity.projectId,
        projectName: identity.projectName,
        projectPath: identity.projectPath,
        sourcePath: targetPath,
        relativePath: source.relativePath,
        kind: source.kind,
        scope: source.scope,
        provider: source.provider,
      });
    },
  );
};
