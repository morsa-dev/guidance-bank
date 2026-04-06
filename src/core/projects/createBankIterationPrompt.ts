import type { DetectableStack, ReferenceProjectCandidate } from "../context/types.js";

import { CREATE_FLOW_COMPLETED_ITERATION, requiresCreateFlowStepOutcome } from "./createFlowPhases.js";
import { renderCreateDeriveGuidance } from "./createBankDeriveGuidance/index.js";
import type { CurrentProjectBankSnapshot } from "./discoverCurrentProjectBank.js";
import type { ExistingGuidanceSource } from "./discoverExistingGuidance.js";

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
  currentBankSnapshot: CurrentProjectBankSnapshot;
  hasExistingProjectBank?: boolean;
};

type CreateFlowStepBuilder = (input: BuildCreateBankIterationPromptInput) => string;

const STABLE_CONTRACT_NOTE = `Use \`phase\` as the main guide for the current create step and treat \`iteration\` as diagnostic only. If \`creationPrompt\` is present, use it as the stable create-flow contract; this step prompt contains only the incremental instruction for the current phase.`;

const renderExistingBankBaselineSection = (
  hasExistingProjectBank: boolean,
  currentBankSnapshot: CurrentProjectBankSnapshot,
): string =>
  hasExistingProjectBank
    ? `## Current Bank Baseline

A project Memory Bank already exists for this repository. Treat the current project bank as the canonical baseline and improve it instead of recreating it blindly.

- Current project bank inventory: ${currentBankSnapshot.entries.length} entr${currentBankSnapshot.entries.length === 1 ? "y" : "ies"}.
- Reuse strong existing entries
- Prefer updating or replacing weak entries over duplicating them
- Remove stale or overlapping entries only when there is clear evidence and the user approves destructive changes
- Use \`list_entries\` and \`read_entry\` with \`scope: "project"\` and the current \`projectPath\` when you need the full text of an existing project-bank entry
`
    : "";

const appendContinuationInstruction = (prompt: string, iteration: number): string => `${prompt}

## Continuation

After completing this step, call \`create_bank\` again with \`iteration: ${iteration + 1}\` and \`stepCompleted: true\`${requiresCreateFlowStepOutcome(iteration) ? ". For this content phase, also provide an explicit result: include `create_bank.apply` changes for the step or set `stepOutcome` to `applied` or `no_changes` (with `stepOutcomeNote` for `no_changes`)." : "."}`;

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

const renderDetectedStacksSection = (detectedStacks: readonly DetectableStack[]): string =>
  detectedStacks.length === 0
    ? `## Detected Stacks

- other`
    : `## Detected Stacks

${detectedStacks.map((stack) => `- ${stack}`).join("\n")}`;

const renderReferenceProjectsSection = (selectedReferenceProjects: readonly ReferenceProjectCandidate[]): string => {
  if (selectedReferenceProjects.length === 0) {
    return `## Reference Projects

No reference project banks were selected for this run.`;
  }

  return `## Reference Projects

${selectedReferenceProjects
  .map(
    (project) => `- ${project.projectName}
  - Project path: \`${project.projectPath}\`
  - Shared stacks: ${project.sharedStacks.join(", ")}`,
  )
  .join("\n")}`;
};

const buildKickoffPrompt = ({
  projectName,
  projectPath,
  projectBankPath,
  rulesDirectory,
  skillsDirectory,
  detectedStacks,
  selectedReferenceProjects,
}: Pick<
  BuildCreateBankIterationPromptInput,
  | "projectName"
  | "projectPath"
  | "projectBankPath"
  | "rulesDirectory"
  | "skillsDirectory"
  | "detectedStacks"
  | "selectedReferenceProjects"
>) => `# Create Flow Kickoff

${STABLE_CONTRACT_NOTE}

Project:
- \`${projectName}\`
- \`${projectPath}\`

Target Memory Bank:
- \`${projectBankPath}\`
- Rules: \`${rulesDirectory}\`
- Skills: \`${skillsDirectory}\`

${renderDetectedStacksSection(detectedStacks)}

${renderReferenceProjectsSection(selectedReferenceProjects)}

What to do in this step:
- inspect the repository and selected reference projects
- form a working plan for which canonical entries are likely needed first
- start writing canonical entries only when the evidence is already strong
- do not import or delete repository-local guidance yet; that review happens in later iterations

Step output:
- one line per created or updated file
- short purpose for each file or planned file
- major uncertainties or skipped areas that should be handled in later iterations`;

const buildReviewExistingPrompt = (projectPath: string, discoveredSources: readonly ExistingGuidanceSource[]): string => `# Existing Guidance Review

${STABLE_CONTRACT_NOTE}

Review available external guidance before importing anything into Memory Bank.

Project path:
- \`${projectPath}\`

${renderDiscoveredSourcesSection(discoveredSources)}

What to do:
- Build a concise source-level picture of guidance that already exists for this project
- Treat the listed repository-local sources as the guaranteed inputs for this review
- If additional provider-global guidance is directly visible in the current agent session, include it in the same review and label it separately
- Skip purely empty, obsolete, or trivial sources without bothering the user
- For each meaningful source, summarize:
  - what the source covers
  - whether it looks project-specific or reusable across projects
  - whether Memory Bank should absorb it fully, partially, or not at all
- Ask the user to choose one strategy per meaningful source:
  - \`ignore\`: keep the source as-is and do not duplicate it into Memory Bank
  - \`copy\`: convert the useful parts into canonical Memory Bank entries and keep the original source
  - \`move\`: convert the useful parts into canonical Memory Bank entries and delete the original source only after explicit confirmation in this chat
  - \`keep source, fill gaps in bank\`: leave the source as the primary record and add only uncovered high-value guidance to Memory Bank
- Keep the user-facing review concise: one source, summary, recommended scope, recommended strategy

Decision rules:
- Recommend \`project\` scope when the guidance depends on this repository's structure, tooling, or workflow
- Recommend \`shared\` scope when the guidance is clearly reusable across repositories
- If scope is unclear, ask the user explicitly instead of guessing
- Ask for source-level strategy decisions, not per-rule micro-decisions
- Never delete or rewrite any original source during this review step`;

const buildImportSelectedPrompt = (discoveredSources: readonly ExistingGuidanceSource[]): string => `# Import Selected Guidance

${STABLE_CONTRACT_NOTE}

Apply the source-level strategies the user approved for external guidance.

${renderDiscoveredSourcesSection(discoveredSources)}

What to do:
- For each source the user reviewed, follow the confirmed strategy exactly
- Convert approved guidance into canonical Memory Bank rules and skills
- Split entries between project scope and shared scope when appropriate
- Assign stable ids, titles, topics, and stacks
- Deduplicate against existing Memory Bank content before writing
- Use \`create_bank\` with an \`apply\` payload for batched canonical writes and deletions during this flow
- If the user approved \`copy\`, preserve the original source and absorb only the useful guidance into Memory Bank
- If the user approved \`move\`, write the canonical entries first and delete the original source only after the deletion is explicitly confirmed
- If the user approved \`keep source, fill gaps in bank\`, preserve the source and write only the uncovered high-value guidance that is missing from Memory Bank
- When replacing or deleting an existing Memory Bank entry, read it first and pass its \`sha256\` back as \`baseSha256\`
- If \`create_bank.apply\` reports a \`conflict\`, re-read the affected entry, rebuild the full final document, and retry with the fresh \`baseSha256\`

Write rules:
- Create a \`rule\` when the source describes a stable constraint, convention, or preference
- Create a \`skill\` when the source describes a reusable workflow or task sequence
- Prefer a small number of high-value entries over fragmented boilerplate
- If a source duplicates existing canonical content, update or skip instead of cloning it

Safety rules:
- Do not delete, rewrite, or trim any original source unless the user explicitly chose \`move\`
- If the user did not clearly approve an action for a source, leave that source untouched
- If one source mixes project-specific and shared material, split it across scopes instead of forcing one destination
- If the chosen strategy was \`keep source, fill gaps in bank\`, avoid re-copying material that already lives in the source clearly enough`;

const buildDeriveFromProjectPrompt = (
  projectPath: string,
  detectedStacks: readonly DetectableStack[],
): string => `# Derive From Project

${STABLE_CONTRACT_NOTE}

Derive additional Memory Bank entries from the real repository.

Project path:
- \`${projectPath}\`

What to do:
- Inspect the real repository directly: project structure, entrypoints, configuration, source files, and recurring implementation patterns
- Create a focused set of high-value project rules and skills
- Prefer stable patterns over one-off details
- Put reusable cross-project guidance into shared scope only when the evidence is strong

Quality rules:
- Do not rely on a server-provided file checklist; gather your own evidence from the real repository
- Prefer patterns confirmed by multiple files, configuration, or stable architecture boundaries
- Skip temporary, noisy, or accidental implementation details
- If a candidate rule is high-impact and your confidence is low, ask the user before writing it
- Apply derived changes through \`create_bank.apply\` in batches instead of a long series of one-entry write calls
- If \`create_bank.apply\` reports a \`conflict\`, re-read the affected entry, rebuild the full final document, and retry with the fresh \`baseSha256\`

${renderCreateDeriveGuidance(detectedStacks)}`;

const buildFinalizePrompt = (): string => `# Finalize Memory Bank

${STABLE_CONTRACT_NOTE}

Finish the project Memory Bank creation flow.

What to do:
- Deduplicate overlapping rules and skills
- Verify scope split between shared and project entries
- Check ids, titles, topics, and stacks for consistency
- If confidence is low for any high-impact rule, ask the user before keeping it
- Use \`create_bank.apply\` for the final cleanup batch when you need to replace or delete multiple entries
- If \`create_bank.apply\` reports a \`conflict\`, re-read the affected entry, rebuild the final canonical document, and retry the cleanup batch with fresh \`baseSha256\`
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
  ({ projectPath, discoveredSources }) => buildReviewExistingPrompt(projectPath, discoveredSources),
  ({ discoveredSources }) => buildImportSelectedPrompt(discoveredSources),
  ({ projectPath, detectedStacks }) =>
    buildDeriveFromProjectPrompt(projectPath, detectedStacks),
  () => buildFinalizePrompt(),
  () => buildCompletedPrompt(),
] as const;

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
    discoveredSources,
    currentBankSnapshot,
    hasExistingProjectBank,
  });

  const promptWithBaseline =
    hasExistingProjectBank && normalizedIteration > 0 && normalizedIteration < CREATE_FLOW_COMPLETED_ITERATION
      ? `${renderExistingBankBaselineSection(true, currentBankSnapshot)}\n${prompt}`
      : prompt;

  return normalizedIteration < CREATE_FLOW_COMPLETED_ITERATION
    ? appendContinuationInstruction(promptWithBaseline, normalizedIteration)
    : promptWithBaseline;
};
