import type { DetectableStack, ReferenceProjectCandidate } from "../context/types.js";

import { buildCreateBankPrompt } from "./createBankPrompt.js";
import type { ExistingGuidanceSource } from "./discoverExistingGuidance.js";
import type { ProjectEvidenceInventory } from "./discoverProjectEvidence.js";
import type { RecentProjectCommit } from "./discoverRecentCommits.js";

type BuildCreateBankIterationPromptInput = {
  iteration: number;
  projectName: string;
  projectPath: string;
  projectBankPath: string;
  rulesDirectory: string;
  skillsDirectory: string;
  detectedStacks: DetectableStack[];
  selectedReferenceProjects: ReferenceProjectCandidate[];
  discoveredSources: ExistingGuidanceSource[];
  projectEvidence: ProjectEvidenceInventory;
  recentCommits: RecentProjectCommit[];
  hasExistingProjectBank?: boolean;
};

type CreateFlowStepBuilder = (input: BuildCreateBankIterationPromptInput) => string;

const renderExistingBankBaselineSection = (hasExistingProjectBank: boolean): string =>
  hasExistingProjectBank
    ? `## Current Bank Baseline

A project Memory Bank already exists for this repository. Treat the current project bank as the canonical baseline and improve it instead of recreating it blindly.

- Reuse strong existing entries
- Prefer updating or replacing weak entries over duplicating them
- Remove stale or overlapping entries only when there is clear evidence and the user approves destructive changes
`
    : "";

const appendContinuationInstruction = (prompt: string, iteration: number): string => `${prompt}

## Continuation

After completing this step, call \`create_bank\` again with \`iteration: ${iteration + 1}\`.`;

const renderDiscoveredSourcesSection = (discoveredSources: readonly ExistingGuidanceSource[]): string => {
  if (discoveredSources.length === 0) {
    return `## Discovered Guidance Sources

No repository-local guidance sources were discovered for this project.`;
  }

  return `## Discovered Guidance Sources

${discoveredSources
  .map((source) => `- [${source.kind}] ${source.relativePath} (${source.entryType})`)
  .join("\n")}`;
};

const renderProjectEvidenceSection = (projectEvidence: ProjectEvidenceInventory): string => {
  const directoryLines =
    projectEvidence.topLevelDirectories.length > 0
      ? projectEvidence.topLevelDirectories.map((directoryName) => `- ${directoryName}`).join("\n")
      : "- No common top-level project directories were auto-detected.";
  const fileLines =
    projectEvidence.evidenceFiles.length > 0
      ? projectEvidence.evidenceFiles.map((file) => `- [${file.kind}] ${file.relativePath}`).join("\n")
      : "- No project evidence files were auto-detected.";

  return `## Project Evidence

Top-level directories:
${directoryLines}

Evidence files:
${fileLines}`;
};

const renderRecentCommitsSection = (recentCommits: readonly RecentProjectCommit[]): string => {
  if (recentCommits.length === 0) {
    return `## Recent Commits

No recent git commits were discovered automatically for this project.`;
  }

  return `## Recent Commits

${recentCommits.map((commit) => `- ${commit.shortHash} ${commit.subject}`).join("\n")}`;
};

const buildReviewExistingPrompt = (projectPath: string, discoveredSources: readonly ExistingGuidanceSource[]): string => `# Existing Guidance Review

Review any existing repository-local guidance before importing it into Memory Bank.

Project path:
- \`${projectPath}\`

${renderDiscoveredSourcesSection(discoveredSources)}

What to do:
- Read the discovered guidance sources and identify what is still useful, redundant, project-specific, or reusable across projects
- Skip purely empty, obsolete, or trivial sources without bothering the user
- For each meaningful source, ask the user to choose exactly one action:
  - \`ignore\`: keep the source as-is and do not duplicate it into Memory Bank
  - \`copy\`: convert it into canonical Memory Bank entries and keep the original source
  - \`move\`: convert it into canonical Memory Bank entries and delete the original source only after explicit confirmation in this chat
- Do not duplicate provider-native guidance blindly into Memory Bank
- Keep the user-facing review concise: one source, summary, recommended scope, requested action

Decision rules:
- Recommend \`project\` scope when the guidance depends on this repository's structure, tooling, or workflow
- Recommend \`shared\` scope when the guidance is clearly reusable across repositories
- If scope is unclear, ask the user explicitly instead of guessing
- Never delete or rewrite any original source during this review step`;

const buildImportSelectedPrompt = (discoveredSources: readonly ExistingGuidanceSource[]): string => `# Import Selected Guidance

Import only the guidance the user approved for canonicalization.

${renderDiscoveredSourcesSection(discoveredSources)}

What to do:
- Convert approved guidance into canonical Memory Bank rules and skills
- Split entries between project scope and shared scope when appropriate
- Assign stable ids, titles, topics, and stacks
- Deduplicate against existing Memory Bank content before writing
- Use MCP mutation tools for all canonical writes
- If the user approved a move instead of a copy, delete the original source only after the canonical entry is written and the deletion is explicitly confirmed

Write rules:
- Create a \`rule\` when the source describes a stable constraint, convention, or preference
- Create a \`skill\` when the source describes a reusable workflow or task sequence
- Prefer a small number of high-value entries over fragmented boilerplate
- If a source duplicates existing canonical content, update or skip instead of cloning it

Safety rules:
- Do not delete, rewrite, or trim any original source unless the user explicitly chose \`move\`
- If the user did not clearly approve an action for a source, leave that source untouched
- If one source mixes project-specific and shared material, split it across scopes instead of forcing one destination`;

const buildDeriveFromProjectPrompt = (projectPath: string, projectEvidence: ProjectEvidenceInventory): string => `# Derive From Project

Derive additional Memory Bank entries from the real repository.

Project path:
- \`${projectPath}\`

${renderProjectEvidenceSection(projectEvidence)}

What to do:
- Inspect project structure, configuration, source files, and recurring implementation patterns
- Create a focused set of high-value project rules and skills
- Prefer stable patterns over one-off details
- Put reusable cross-project guidance into shared scope only when the evidence is strong

Quality rules:
- Use the discovered project evidence as starting points, not as a checklist
- Prefer patterns confirmed by multiple files, configuration, or stable architecture boundaries
- Skip temporary, noisy, or accidental implementation details
- If a candidate rule is high-impact and your confidence is low, ask the user before writing it`;

const buildDeriveFromDocsAndCommitsPrompt = (
  projectEvidence: ProjectEvidenceInventory,
  recentCommits: readonly RecentProjectCommit[],
): string => `# Derive From Docs And Commits

Use repository documentation and recent change history as additional evidence.

${renderProjectEvidenceSection({
  ...projectEvidence,
  topLevelDirectories: [],
})}

${renderRecentCommitsSection(recentCommits)}

What to do:
- Review README and any relevant docs folders or docs files
- Review the latest 5 commits for repeated corrections, constraints, or workflow expectations
- Convert only stable, evidence-backed patterns into canonical Memory Bank entries
- Skip noisy or temporary details

Evidence rules:
- Treat docs and commits as supporting evidence, not automatic truth
- Promote a pattern into Memory Bank only when it looks stable and likely to matter for future work
- If commits show repeated fixes around the same issue, consider extracting one concise rule instead of several narrow ones
- If documentation conflicts with the current codebase, prefer the codebase and mention the conflict to the user if it matters`;

const buildFinalizePrompt = (): string => `# Finalize Memory Bank

Finish the project Memory Bank creation flow.

What to do:
- Deduplicate overlapping rules and skills
- Verify scope split between shared and project entries
- Check ids, titles, topics, and stacks for consistency
- If confidence is low for any high-impact rule, ask the user before keeping it
- Return a concise completion report when the bank is in a good canonical state

Final pass checklist:
- Remove near-duplicate entries and merge them into the clearest canonical version
- Ensure each entry is either clearly a \`rule\` or clearly a \`skill\`
- Ensure project overrides do not duplicate shared guidance without adding real specificity
- Leave unresolved or low-confidence items out unless the user explicitly approves them
- In the final report, mention imported sources, newly derived entries, and any important skipped uncertainties`;

const buildCompletedPrompt = (): string => `# Create Flow Completed

The iterative project Memory Bank creation flow is complete.

What to do:
- Do not continue the create flow automatically
- Re-enter the flow only if the user explicitly asks for another create pass or wants to restart parts of the review
- Continue normal Memory Bank work through the standard mutation tools when the user asks for targeted updates`;

const CREATE_FLOW_PROMPT_BUILDERS: readonly CreateFlowStepBuilder[] = [
  ({
    projectName,
    projectPath,
    projectBankPath,
    rulesDirectory,
    skillsDirectory,
    detectedStacks,
    selectedReferenceProjects,
  }) =>
    buildCreateBankPrompt({
      projectName,
      projectPath,
      projectBankPath,
      rulesDirectory,
      skillsDirectory,
      detectedStacks,
      selectedReferenceProjects,
    }),
  ({ projectPath, discoveredSources }) => buildReviewExistingPrompt(projectPath, discoveredSources),
  ({ discoveredSources }) => buildImportSelectedPrompt(discoveredSources),
  ({ projectPath, projectEvidence }) => buildDeriveFromProjectPrompt(projectPath, projectEvidence),
  ({ projectEvidence, recentCommits }) => buildDeriveFromDocsAndCommitsPrompt(projectEvidence, recentCommits),
  () => buildFinalizePrompt(),
  () => buildCompletedPrompt(),
] as const;

export const CREATE_FLOW_COMPLETED_ITERATION = CREATE_FLOW_PROMPT_BUILDERS.length - 1;

export const getNextCreateFlowIteration = (iteration: number): number | null =>
  iteration < CREATE_FLOW_COMPLETED_ITERATION ? iteration + 1 : null;

export const isCreateFlowComplete = (iteration: number): boolean => iteration >= CREATE_FLOW_COMPLETED_ITERATION;

export const buildReadyProjectBankPrompt = ({
  updatedAt,
  updatedDaysAgo,
}: {
  updatedAt: string | null;
  updatedDaysAgo: number | null;
}): string => {
  const updatedLine =
    updatedAt === null || updatedDaysAgo === null
      ? "A project Memory Bank already exists for this repository."
      : `A project Memory Bank already exists for this repository and was last updated ${updatedDaysAgo} day${updatedDaysAgo === 1 ? "" : "s"} ago (${updatedAt}).`;

  return `# Existing Project Memory Bank

${updatedLine}

What to do:
- Tell the user that a project Memory Bank already exists for this repository
- Ask whether they want to improve it now instead of keeping it as-is
- If the user wants to improve it, call \`create_bank\` again with \`iteration: 1\`
- If the user does not want to improve it, continue normal work with the current ready bank through \`resolve_context\`
- If you continue into later create iterations, treat the existing project bank as the canonical baseline and improve gaps, stale entries, duplicates, and weak coverage instead of recreating the bank from scratch`;
};

export const buildCreateBankIterationPrompt = ({
  iteration,
  projectName,
  projectPath,
  projectBankPath,
  rulesDirectory,
  skillsDirectory,
  detectedStacks,
  selectedReferenceProjects,
  discoveredSources,
  projectEvidence,
  recentCommits,
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
    discoveredSources,
    projectEvidence,
    recentCommits,
    hasExistingProjectBank,
  });

  const promptWithBaseline =
    hasExistingProjectBank && normalizedIteration > 0 && normalizedIteration < CREATE_FLOW_COMPLETED_ITERATION
      ? `${renderExistingBankBaselineSection(true)}\n${prompt}`
      : prompt;

  return normalizedIteration < CREATE_FLOW_COMPLETED_ITERATION
    ? appendContinuationInstruction(promptWithBaseline, normalizedIteration)
    : promptWithBaseline;
};
