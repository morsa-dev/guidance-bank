import type { DetectableStack, ReferenceProjectCandidate } from "../../context/types.js";

import { CREATE_FLOW_COMPLETED_ITERATION } from "./createFlowPhases.js";
import type { CurrentProjectBankSnapshot } from "../discoverCurrentProjectBank.js";
import type { ExistingGuidanceSource } from "../discoverExistingGuidance.js";
import type { ConfirmedGuidanceSourceStrategy } from "./guidanceStrategies.js";
import type { PendingSourceReviewBucket } from "./sourceReviewBuckets.js";
import {
  appendContinuationInstruction,
  buildCompletedPrompt,
  buildDeriveFromProjectPrompt,
  buildFinalizePrompt,
  buildImportSelectedPrompt,
  buildKickoffPrompt,
  buildReadyProjectBankPrompt,
  buildReviewExistingPrompt,
  renderExistingBankBaselineSection,
} from "./createBankPromptSections.js";

type BuildCreateBankIterationPromptInput = {
  iteration: number;
  projectName: string;
  projectPath: string;
  projectBankPath: string;
  rulesDirectory: string;
  skillsDirectory: string;
  detectedStacks: DetectableStack[];
  selectedReferenceProjects: ReferenceProjectCandidate[];
  confirmedSourceStrategies: ConfirmedGuidanceSourceStrategy[];
  pendingSourceReviewBuckets: PendingSourceReviewBucket[];
  discoveredSources: ExistingGuidanceSource[];
  currentBankSnapshot: CurrentProjectBankSnapshot;
  hasExistingProjectBank?: boolean;
};

type CreateFlowStepBuilder = (input: BuildCreateBankIterationPromptInput) => string;

const CREATE_FLOW_PROMPT_BUILDERS: readonly CreateFlowStepBuilder[] = [
  ({ projectName, projectPath, projectBankPath, rulesDirectory, skillsDirectory, detectedStacks, selectedReferenceProjects }) =>
    buildKickoffPrompt({
      projectName,
      projectPath,
      projectBankPath,
      rulesDirectory,
      skillsDirectory,
      detectedStacks,
      selectedReferenceProjects,
    }),
  ({ projectPath, pendingSourceReviewBuckets }) =>
    buildReviewExistingPrompt({
      projectPath,
      pendingSourceReviewBuckets,
    }),
  ({ confirmedSourceStrategies, discoveredSources }) =>
    buildImportSelectedPrompt({
      confirmedSourceStrategies,
      discoveredSources,
    }),
  ({ projectPath, detectedStacks }) =>
    buildDeriveFromProjectPrompt({
      projectPath,
      detectedStacks,
    }),
  () => buildFinalizePrompt(),
  () => buildCompletedPrompt(),
] as const;

export { buildReadyProjectBankPrompt };

export const buildCreateBankIterationPrompt = ({
  iteration,
  projectName,
  projectPath,
  projectBankPath,
  rulesDirectory,
  skillsDirectory,
  detectedStacks,
  selectedReferenceProjects,
  confirmedSourceStrategies,
  pendingSourceReviewBuckets,
  discoveredSources,
  currentBankSnapshot,
  hasExistingProjectBank = false,
}: BuildCreateBankIterationPromptInput): string => {
  const normalizedIteration = Math.min(Math.max(iteration, 0), CREATE_FLOW_COMPLETED_ITERATION);
  const buildPrompt = CREATE_FLOW_PROMPT_BUILDERS[normalizedIteration]!;
  const prompt = buildPrompt({
    iteration,
    projectName,
    projectPath,
    projectBankPath,
    rulesDirectory,
    skillsDirectory,
    detectedStacks,
    selectedReferenceProjects,
    confirmedSourceStrategies,
    pendingSourceReviewBuckets,
    discoveredSources,
    currentBankSnapshot,
    hasExistingProjectBank,
  });

  const promptWithBaseline =
    hasExistingProjectBank && normalizedIteration > 0 && normalizedIteration < CREATE_FLOW_COMPLETED_ITERATION
      ? `${renderExistingBankBaselineSection(currentBankSnapshot)}\n${prompt}`
      : prompt;

  return normalizedIteration < CREATE_FLOW_COMPLETED_ITERATION
    ? appendContinuationInstruction(promptWithBaseline, normalizedIteration)
    : promptWithBaseline;
};
