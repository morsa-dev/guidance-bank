import type { BankRepository } from "../../storage/bankRepository.js";
import {
  getProjectBankContinuationIteration,
  resolveProjectBankLifecycleStatus,
} from "../bank/lifecycle.js";
import { detectProjectContext } from "./detectProjectContext.js";
import type { ResolvedMemoryBankContext } from "./types.js";
import { findReferenceProjects } from "../projects/findReferenceProjects.js";
import { getCreateFlowPhase } from "../projects/createFlowPhases.js";
import { resolveProjectIdentity } from "../projects/identity.js";
import {
  assertUniqueResolvedEntryIds,
  buildResolvedContextCatalog,
  excludeAlwaysOnRules,
  loadResolvedContextEntries,
  mergeResolvedLayerEntries,
  selectAlwaysOnRules,
} from "./contextEntryResolver.js";
import {
  buildCreatingContextText,
  buildDeclinedContextText,
  buildMissingContextText,
  buildReadyContextText,
  buildSharedFallbackContextText,
  buildSyncRequiredContextText,
} from "./contextTextRenderer.js";

type ResolveContextOptions = {
  repository: BankRepository;
  projectPath: string;
};

export const resolveMemoryBankContext = async ({
  repository,
  projectPath,
}: ResolveContextOptions): Promise<ResolvedMemoryBankContext> => {
  const identity = resolveProjectIdentity(projectPath);
  const manifest = await repository.readManifest();
  const detectedProjectContext = await detectProjectContext(identity.projectPath);
  const projectManifest = await repository.readProjectManifestOptional(identity.projectId);
  const projectState = await repository.readProjectStateOptional(identity.projectId);
  const status = resolveProjectBankLifecycleStatus({
    projectManifest,
    projectState,
    expectedStorageVersion: manifest.storageVersion,
  });

  if (status === "sync_required") {
    return {
      text: buildSyncRequiredContextText({
        postponedUntil: projectState?.postponedUntil ?? null,
      }),
      creationState: projectState?.creationState ?? "ready",
      requiredAction: "sync_bank",
    };
  }

  if (status === "creation_declined") {
    return {
      text: buildDeclinedContextText(),
      creationState: "declined",
    };
  }

  if (status === "missing") {
    const referenceProjects = await findReferenceProjects({
      repository,
      currentProjectId: identity.projectId,
      detectedStacks: detectedProjectContext.detectedStacks,
    });
    const creationState = projectState?.creationState === "postponed" ? "postponed" : "unknown";
    const sharedRules = await loadResolvedContextEntries(repository, "shared", "rules", detectedProjectContext.detectedStacks);
    const sharedSkills = await loadResolvedContextEntries(repository, "shared", "skills", detectedProjectContext.detectedStacks);

    assertUniqueResolvedEntryIds(sharedRules, "shared", "rules");
    assertUniqueResolvedEntryIds(sharedSkills, "shared", "skills");

    const alwaysOnRules = selectAlwaysOnRules(sharedRules);
    const rulesCatalog = buildResolvedContextCatalog("rules", excludeAlwaysOnRules(sharedRules));
    const skillsCatalog = buildResolvedContextCatalog("skills", sharedSkills);

    const text = buildMissingContextText({
      referenceProjectPaths: referenceProjects.map((project) => project.projectPath),
      creationState,
      sharedContextText: buildSharedFallbackContextText({
        projectPath: identity.projectPath,
        detectedStacks: detectedProjectContext.detectedStacks,
        alwaysOnRules,
        rulesCatalog,
        skillsCatalog,
      }),
    });

    return referenceProjects.length > 0
      ? {
          text,
          creationState,
          recommendedAction: "create_bank",
          detectedStacks: detectedProjectContext.detectedStacks,
          rulesCatalog,
          skillsCatalog,
          referenceProjects,
        }
      : {
          text,
          creationState,
          recommendedAction: "create_bank",
          detectedStacks: detectedProjectContext.detectedStacks,
          rulesCatalog,
          skillsCatalog,
        };
  }

  if (status === "creation_in_progress") {
    const nextIteration = getProjectBankContinuationIteration(projectState);
    const createFlowPhase = getCreateFlowPhase(nextIteration);

    return {
      text: buildCreatingContextText({
        phase: createFlowPhase,
        nextIteration,
      }),
      creationState: "creating",
      requiredAction: "continue_create_bank",
      createFlowPhase,
      nextIteration,
    };
  }

  const sharedRules = await loadResolvedContextEntries(repository, "shared", "rules", detectedProjectContext.detectedStacks);
  const sharedSkills = await loadResolvedContextEntries(repository, "shared", "skills", detectedProjectContext.detectedStacks);
  const projectRules = await loadResolvedContextEntries(
    repository,
    "project",
    "rules",
    detectedProjectContext.detectedStacks,
    identity.projectId,
  );
  const projectSkills = await loadResolvedContextEntries(
    repository,
    "project",
    "skills",
    detectedProjectContext.detectedStacks,
    identity.projectId,
  );

  assertUniqueResolvedEntryIds(sharedRules, "shared", "rules");
  assertUniqueResolvedEntryIds(sharedSkills, "shared", "skills");
  assertUniqueResolvedEntryIds(projectRules, "project", "rules");
  assertUniqueResolvedEntryIds(projectSkills, "project", "skills");

  const mergedRules = mergeResolvedLayerEntries(sharedRules, projectRules);
  const mergedSkills = mergeResolvedLayerEntries(sharedSkills, projectSkills);
  const alwaysOnRules = selectAlwaysOnRules(mergedRules);
  const rulesCatalog = buildResolvedContextCatalog("rules", excludeAlwaysOnRules(mergedRules));
  const skillsCatalog = buildResolvedContextCatalog("skills", mergedSkills);

  return {
    text: buildReadyContextText({
      projectPath: identity.projectPath,
      detectedStacks: detectedProjectContext.detectedStacks,
      alwaysOnRules,
      rulesCatalog,
      skillsCatalog,
    }),
    creationState: "ready",
    detectedStacks: detectedProjectContext.detectedStacks,
    rulesCatalog,
    skillsCatalog,
  };
};
