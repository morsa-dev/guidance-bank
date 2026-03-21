import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../bank/canonicalEntry.js";
import {
  createProjectBankState,
  markProjectBankSynced,
  postponeProjectBankSync,
  updateProjectBankManifest,
} from "../bank/project.js";
import type { EntryKind, EntryScope } from "../bank/types.js";
import { detectProjectContext } from "../context/detectProjectContext.js";
import { resolveProjectIdentity } from "../projects/identity.js";
import { BankRepository } from "../../storage/bankRepository.js";
import { ValidationError } from "../../shared/errors.js";
import { resolveBankRoot } from "../../shared/paths.js";
import type { SyncResult } from "./syncTypes.js";

type SyncOptions = {
  bankRoot?: string;
  projectPath: string;
};

const isDocumentationFile = (entryPath: string): boolean => {
  const normalizedEntryPath = entryPath.replaceAll("\\", "/").toLowerCase();
  return normalizedEntryPath.endsWith("/readme.md") || normalizedEntryPath === "readme.md";
};

const validateLayer = async (
  repository: BankRepository,
  layer: EntryScope,
  kind: EntryKind,
  projectId?: string,
): Promise<number> => {
  const entries = await repository.listLayerEntries(layer, kind, projectId);
  let validatedCount = 0;

  for (const entry of entries) {
    if (isDocumentationFile(entry.path)) {
      continue;
    }

    const content = await repository.readLayerEntry(layer, kind, entry.path, projectId);

    try {
      if (kind === "rules") {
        parseCanonicalRuleDocument(content);
      } else {
        parseCanonicalSkillDocument(content);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown canonical entry parsing error.";
      throw new ValidationError(`Invalid canonical ${kind.slice(0, -1)} at ${layer}/${entry.path}: ${message}`);
    }

    validatedCount += 1;
  }

  return validatedCount;
};

export class SyncService {
  async run(options: SyncOptions): Promise<SyncResult> {
    const bankRoot = resolveBankRoot(options.bankRoot);
    const repository = new BankRepository(bankRoot);
    const manifest = await repository.readManifestOptional();

    if (manifest === null) {
      throw new ValidationError("Memory Bank is not initialized yet. Run mb init first.");
    }

    const identity = resolveProjectIdentity(options.projectPath);
    const projectContext = await detectProjectContext(identity.projectPath);
    const projectManifest = await repository.readProjectManifestOptional(identity.projectId);
    const projectState = await repository.readProjectStateOptional(identity.projectId);

    const sharedRules = await validateLayer(repository, "shared", "rules");
    const sharedSkills = await validateLayer(repository, "shared", "skills");
    const projectRules = projectManifest !== null ? await validateLayer(repository, "project", "rules", identity.projectId) : 0;
    const projectSkills =
      projectManifest !== null ? await validateLayer(repository, "project", "skills", identity.projectId) : 0;

    let projectManifestUpdated = false;
    if (projectManifest !== null) {
      const nextDetectedStacks = [...projectContext.detectedStacks];
      const currentDetectedStacks = [...projectManifest.detectedStacks];
      const stacksChanged =
        nextDetectedStacks.length !== currentDetectedStacks.length ||
        nextDetectedStacks.some((stack, index) => stack !== currentDetectedStacks[index]);

      if (stacksChanged) {
        await repository.writeProjectManifest(
          identity.projectId,
          updateProjectBankManifest(projectManifest, projectContext.detectedStacks),
        );
        projectManifestUpdated = true;
      }
    }

    if (projectManifest !== null) {
      const nextProjectState = markProjectBankSynced(
        projectState ?? createProjectBankState("ready"),
        manifest.storageVersion,
      );
      await repository.writeProjectState(identity.projectId, nextProjectState);

      return {
        action: "run",
        bankRoot,
        projectPath: identity.projectPath,
        detectedStacks: projectContext.detectedStacks,
        projectState: nextProjectState.creationState,
        postponedUntil: nextProjectState.postponedUntil,
        projectManifestUpdated,
        validatedEntries: {
          shared: {
            rules: sharedRules,
            skills: sharedSkills,
          },
          project: {
            rules: projectRules,
            skills: projectSkills,
          },
        },
        externalGuidanceSources: projectContext.localGuidance,
      };
    }

    return {
      action: "run",
      bankRoot,
      projectPath: identity.projectPath,
      detectedStacks: projectContext.detectedStacks,
      projectState: projectState?.creationState ?? "unknown",
      postponedUntil: projectState?.postponedUntil ?? null,
      projectManifestUpdated,
      validatedEntries: {
        shared: {
          rules: sharedRules,
          skills: sharedSkills,
        },
        project: {
          rules: projectRules,
          skills: projectSkills,
        },
      },
      externalGuidanceSources: projectContext.localGuidance,
    };
  }

  async postpone(options: SyncOptions): Promise<SyncResult> {
    const bankRoot = resolveBankRoot(options.bankRoot);
    const repository = new BankRepository(bankRoot);
    const manifest = await repository.readManifestOptional();

    if (manifest === null) {
      throw new ValidationError("Memory Bank is not initialized yet. Run mb init first.");
    }

    const identity = resolveProjectIdentity(options.projectPath);
    const projectContext = await detectProjectContext(identity.projectPath);
    const projectManifest = await repository.readProjectManifestOptional(identity.projectId);

    if (projectManifest === null) {
      throw new ValidationError("Project Memory Bank does not exist yet. Call create_bank before postponing sync.");
    }

    const projectState = await repository.readProjectStateOptional(identity.projectId);
    const nextProjectState = postponeProjectBankSync(
      projectState ?? createProjectBankState("ready"),
      1,
    );

    await repository.writeProjectState(identity.projectId, nextProjectState);

    return {
      action: "postpone",
      bankRoot,
      projectPath: identity.projectPath,
      detectedStacks: projectContext.detectedStacks,
      projectState: nextProjectState.creationState,
      postponedUntil: nextProjectState.postponedUntil,
      projectManifestUpdated: false,
      validatedEntries: {
        shared: {
          rules: 0,
          skills: 0,
        },
        project: {
          rules: 0,
          skills: 0,
        },
      },
      externalGuidanceSources: projectContext.localGuidance,
    };
  }
}
