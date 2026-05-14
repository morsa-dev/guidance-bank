import type { BankRepository } from "../../storage/bankRepository.js";
import { BankRepository as EffectiveBankRepository } from "../../storage/bankRepository.js";
import {
  resolveProjectBankLifecycleStatus,
} from "../bank/lifecycle.js";
import { resolveProjectLocalBankPaths } from "../bank/projectLocalBank.js";
import { detectBankUpgrade } from "../upgrade/upgradeService.js";
import { detectProjectContext } from "./detectProjectContext.js";
import type { DetectableStack, ResolvedGuidanceBankContext } from "./types.js";
import { createManifest } from "../bank/manifest.js";
import { findReferenceProjects } from "../projects/findReferenceProjects.js";
import { resolveProjectIdentity } from "../projects/identity.js";
import { ProjectLocalEntryStore } from "../../storage/projectLocalEntryStore.js";
import {
  assertUniqueResolvedEntryIds,
  buildResolvedContextCatalog,
  excludeAlwaysOnRules,
  loadResolvedContextEntries,
  mergeResolvedLayerEntries,
  selectAlwaysOnRules,
} from "./contextEntryResolver.js";
import { loadProjectLocalContextEntries } from "./projectLocalContextEntryResolver.js";
import {
  buildProjectLocalBankDisabledContextText,
  buildDeclinedContextText,
  buildMissingContextText,
  buildReadyContextText,
  buildSharedFallbackContextText,
} from "./contextTextRenderer.js";
import { createDefaultMcpServerConfig } from "../../mcp/config.js";

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
  let effectiveRepository: BankRepository = repository;

  if (bankUpgrade.status === "not_initialized") {
    await repository.ensureStructure();
    await repository.ensureStarterFiles();
    await repository.writeManifest(createManifest([]));
    await repository.writeMcpServerConfig(createDefaultMcpServerConfig(repository.rootPath));
  } else if (bankUpgrade.status === "upgrade_required") {
    effectiveRepository = new EffectiveBankRepository(bankUpgrade.sourceRoot);
  }

  const manifest = await effectiveRepository.readManifest();
  const detectedProjectContext = await detectProjectContext(identity.projectPath);
  const projectManifest = await effectiveRepository.readProjectManifestOptional(identity.projectId);
  const projectState = await effectiveRepository.readProjectStateOptional(identity.projectId);
  const status = resolveProjectBankLifecycleStatus({
    projectManifest,
    projectState,
    expectedStorageVersion: manifest.storageVersion,
  });

  if (status === "creation_declined") {
    return {
      text: buildDeclinedContextText(),
      creationState: "declined",
    };
  }

  if (status === "missing") {
    const referenceProjects = await findReferenceProjects({
      repository: effectiveRepository,
      currentProjectId: identity.projectId,
      detectedStacks: detectedProjectContext.detectedStacks,
    });
    const sharedRules = await loadResolvedContextEntries(
      effectiveRepository,
      "shared",
      "rules",
      detectedProjectContext.detectedStacks,
    );
    const sharedSkills = await loadResolvedContextEntries(
      effectiveRepository,
      "shared",
      "skills",
      detectedProjectContext.detectedStacks,
    );

    assertUniqueResolvedEntryIds(sharedRules, "shared", "rules");
    assertUniqueResolvedEntryIds(sharedSkills, "shared", "skills");

    const alwaysOnRules = selectAlwaysOnRules(sharedRules);
    const rulesCatalog = buildResolvedContextCatalog("rules", excludeAlwaysOnRules(sharedRules));
    const skillsCatalog = buildResolvedContextCatalog("skills", sharedSkills);

    const text = buildMissingContextText({
      referenceProjectPaths: referenceProjects.map((project) => project.projectPath),
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
      creationState: "unknown",
      detectedStacks: [...detectedProjectContext.detectedStacks] as DetectableStack[],
      rulesCatalog,
      skillsCatalog,
    };

    return referenceProjects.length > 0
      ? {
          ...missingContextBase,
          referenceProjects,
        }
      : missingContextBase;
  }

  const sharedRules = await loadResolvedContextEntries(
    effectiveRepository,
    "shared",
    "rules",
    detectedProjectContext.detectedStacks,
  );
  const sharedSkills = await loadResolvedContextEntries(
    effectiveRepository,
    "shared",
    "skills",
    detectedProjectContext.detectedStacks,
  );

  const isProjectLocal = projectManifest?.storageMode === "project-local";
  if (isProjectLocal && projectState?.projectLocalBankDisabled) {
    return {
      text: buildProjectLocalBankDisabledContextText(),
      creationState: "ready",
      projectLocalBankDisabled: true,
    };
  }

  const [projectRules, projectSkills] = isProjectLocal
    ? await (async () => {
        const localStore = new ProjectLocalEntryStore(resolveProjectLocalBankPaths(identity.projectPath));
        return Promise.all([
          loadProjectLocalContextEntries(localStore, "rules", detectedProjectContext.detectedStacks),
          loadProjectLocalContextEntries(localStore, "skills", detectedProjectContext.detectedStacks),
        ]);
      })()
    : await Promise.all([
        loadResolvedContextEntries(
          effectiveRepository,
          "project",
          "rules",
          detectedProjectContext.detectedStacks,
          identity.projectId,
        ),
        loadResolvedContextEntries(
          effectiveRepository,
          "project",
          "skills",
          detectedProjectContext.detectedStacks,
          identity.projectId,
        ),
      ]);

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
    creationState: projectState?.creationState ?? "ready",
    detectedStacks: detectedProjectContext.detectedStacks,
    rulesCatalog,
    skillsCatalog,
  };
};
