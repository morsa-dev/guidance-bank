import type { BankRepository } from "../../storage/bankRepository.js";
import {
  getProjectBankContinuationIteration,
  isProjectBankPostponedUntilActive,
  resolveProjectBankLifecycleStatus,
} from "../bank/lifecycle.js";
import { detectBankUpgrade } from "../upgrade/upgradeService.js";
import { detectProjectContext } from "./detectProjectContext.js";
import type { DetectableStack, ResolvedGuidanceBankContext } from "./types.js";
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
  buildUpgradeRequiredContextText,
} from "./contextTextRenderer.js";
import { ValidationError } from "../../shared/errors.js";

type ResolveContextOptions = {
  repository: BankRepository;
  projectPath: string;
};

export const resolveGuidanceBankContext = async ({
  repository,
  projectPath,
}: ResolveContextOptions): Promise<ResolvedGuidanceBankContext> => {
  const identity = resolveProjectIdentity(projectPath);
  const bankUpgrade = await detectBankUpgrade(repository.rootPath);

  if (bankUpgrade.status === "not_initialized") {
    throw new ValidationError(`AI Guidance Bank is not initialized yet. Run \`gbank init\` first.`);
  }

  if (bankUpgrade.status === "upgrade_required") {
    return {
      text: buildUpgradeRequiredContextText({
        bankRoot: bankUpgrade.bankRoot,
        sourceRoot: bankUpgrade.sourceRoot,
        storageVersion: bankUpgrade.manifest.storageVersion,
        expectedStorageVersion: bankUpgrade.expectedStorageVersion,
      }),
      requiredAction: "upgrade_bank",
      bankRoot: bankUpgrade.bankRoot,
      sourceRoot: bankUpgrade.sourceRoot,
      storageVersion: bankUpgrade.manifest.storageVersion,
      expectedStorageVersion: bankUpgrade.expectedStorageVersion,
    };
  }

  const manifest = bankUpgrade.manifest;
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
    const isCreateReminderPostponed =
      projectState?.creationState === "postponed" && isProjectBankPostponedUntilActive(projectState);
    const creationState = isCreateReminderPostponed ? "postponed" : "unknown";
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
      postponedUntil: isCreateReminderPostponed ? projectState?.postponedUntil ?? null : null,
      sharedContextText: buildSharedFallbackContextText({
        projectPath: identity.projectPath,
        detectedStacks: detectedProjectContext.detectedStacks,
        alwaysOnRules,
        rulesCatalog,
        skillsCatalog,
      }),
    });
    const missingContextBase: ResolvedGuidanceBankContext = {
      text,
      creationState: creationState as "unknown" | "postponed",
      detectedStacks: [...detectedProjectContext.detectedStacks] as DetectableStack[],
      rulesCatalog,
      skillsCatalog,
      ...(isCreateReminderPostponed ? { postponedUntil: projectState?.postponedUntil ?? null } : {}),
      ...(!isCreateReminderPostponed ? { recommendedAction: "create_bank" as const } : {}),
    };

    return referenceProjects.length > 0
      ? {
          ...missingContextBase,
          referenceProjects,
        }
      : missingContextBase;
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
