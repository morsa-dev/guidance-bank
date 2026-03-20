import type { BankRepository } from "../../storage/bankRepository.js";
import { detectProjectContext } from "../context/detectProjectContext.js";
import { DETECTABLE_STACKS, type DetectableStack, type ReferenceProjectCandidate } from "../context/types.js";

type FindReferenceProjectsOptions = {
  repository: BankRepository;
  currentProjectId: string;
  detectedStacks: readonly DetectableStack[];
};

const intersectStacks = (
  left: readonly DetectableStack[],
  right: readonly string[],
): DetectableStack[] => left.filter((stack) => right.includes(stack));

const detectableStackSet = new Set<string>(DETECTABLE_STACKS);

export const findReferenceProjects = async ({
  repository,
  currentProjectId,
  detectedStacks,
}: FindReferenceProjectsOptions): Promise<ReferenceProjectCandidate[]> => {
  const manifests = await repository.listProjectManifests();
  const candidates = await Promise.all(
    manifests
      .filter((manifest) => manifest.projectId !== currentProjectId)
      .map(async (manifest) => {
        const manifestStacks =
          manifest.detectedStacks.length > 0
            ? manifest.detectedStacks
            : (await detectProjectContext(manifest.projectPath).catch(() => null))?.detectedStacks ?? [];
        const normalizedStacks = manifestStacks.filter((stack): stack is DetectableStack => detectableStackSet.has(stack));
        const sharedStacks = intersectStacks(detectedStacks, normalizedStacks);

        return {
          projectId: manifest.projectId,
          projectName: manifest.projectName,
          projectPath: manifest.projectPath,
          projectBankPath: repository.paths.projectDirectory(manifest.projectId),
          detectedStacks: normalizedStacks,
          sharedStacks,
          updatedAt: manifest.updatedAt,
        };
      }),
  );

  return candidates
    .filter((candidate) => candidate.sharedStacks.length > 0)
    .sort((left, right) => {
      if (right.sharedStacks.length !== left.sharedStacks.length) {
        return right.sharedStacks.length - left.sharedStacks.length;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, 5)
    .map((candidate) => ({
      projectId: candidate.projectId,
      projectName: candidate.projectName,
      projectPath: candidate.projectPath,
      projectBankPath: candidate.projectBankPath,
      detectedStacks: candidate.detectedStacks,
      sharedStacks: candidate.sharedStacks,
    }));
};
