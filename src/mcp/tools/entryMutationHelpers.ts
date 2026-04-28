import { z } from "zod";

import { resolveProjectLocalBankPaths } from "../../core/bank/projectLocalBank.js";
import type { EntryKind, EntryScope } from "../../core/bank/types.js";
import { resolveProjectIdentity } from "../../core/projects/identity.js";
import type { BankRepository } from "../../storage/bankRepository.js";
import { ProjectLocalEntryStore } from "../../storage/projectLocalEntryStore.js";
import { toSkillDocumentPath } from "./auditUtils.js";

type ScopedMutationContext = {
  identity: ReturnType<typeof resolveProjectIdentity>;
  projectId: string | undefined;
};

export const buildInvalidToolArgsResult = (toolName: string, error: z.ZodError) => ({
  isError: true as const,
  content: [
    {
      type: "text" as const,
      text: `Invalid arguments for tool ${toolName}: ${z.prettifyError(error)}`,
    },
  ],
});

export const buildStructuredToolResult = <TPayload extends Record<string, unknown>>(payload: TPayload) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(payload, null, 2),
    },
  ],
  structuredContent: payload,
});

export const resolveScopedMutationContext = async ({
  repository,
  projectPath,
  scope,
  missingProjectMessage,
}: {
  repository: BankRepository;
  projectPath: string;
  scope: EntryScope;
  missingProjectMessage: string;
}): Promise<ScopedMutationContext | { isError: true; content: [{ type: "text"; text: string }] }> => {
  const identity = resolveProjectIdentity(projectPath);
  const projectId = scope === "project" ? identity.projectId : undefined;

  if (scope === "project") {
    const projectManifest = await repository.readProjectManifestOptional(identity.projectId);
    if (projectManifest === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: missingProjectMessage,
          },
        ],
      };
    }
  }

  return {
    identity,
    projectId,
  };
};

export const resolveProjectLocalStore = async (
  repository: BankRepository,
  projectPath: string,
): Promise<ProjectLocalEntryStore | null> => {
  const { projectId } = resolveProjectIdentity(projectPath);
  const manifest = await repository.readProjectManifestOptional(projectId);
  if (manifest?.storageMode !== "project-local") return null;
  return new ProjectLocalEntryStore(resolveProjectLocalBankPaths(projectPath));
};

export const readEntryBeforeMutation = async ({
  repository,
  scope,
  kind,
  path,
  projectId,
}: {
  repository: BankRepository;
  scope: EntryScope;
  kind: EntryKind;
  path: string;
  projectId?: string;
}): Promise<string | null> =>
  repository.readLayerEntryOptional(
    scope,
    kind,
    kind === "skills" ? toSkillDocumentPath(path) : path,
    projectId,
  );
