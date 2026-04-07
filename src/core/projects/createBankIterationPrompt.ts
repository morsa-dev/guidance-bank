import type { DetectableStack, ReferenceProjectCandidate } from "../context/types.js";

import { CREATE_FLOW_COMPLETED_ITERATION, requiresCreateFlowStepOutcome } from "./createFlowPhases.js";
import { renderCreateDeriveGuidance } from "./createBankDeriveGuidance/index.js";
import type { CurrentProjectBankSnapshot } from "./discoverCurrentProjectBank.js";
import type { ExistingGuidanceSource } from "./discoverExistingGuidance.js";
import {
  formatGuidanceSourceStrategy,
  type ConfirmedGuidanceSourceStrategy,
} from "./guidanceStrategies.js";

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
  confirmedSourceStrategies: ConfirmedGuidanceSourceStrategy[];
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

const appendContinuationInstruction = (prompt: string, iteration: number): string => {
  const continuationSuffix = (() => {
    if (!requiresCreateFlowStepOutcome(iteration)) {
      return ".";
    }

    if (iteration === 3) {
      return ". For this content phase, also provide an explicit result: include `create_bank.apply` changes for the step or set `stepOutcome` to `applied` or `no_changes`. If you use `no_changes`, use `stepOutcomeNote` to explain which strongest remaining candidates were reviewed and why they were skipped.";
    }

    if (iteration === 4) {
      return ". For this content phase, also provide an explicit result: include `create_bank.apply` changes for the step or set `stepOutcome` to `applied` or `no_changes`. If you use `no_changes`, use `stepOutcomeNote` to summarize the strongest skipped or already-covered high-value candidates and why the bank is complete enough.";
    }

    return ". For this content phase, also provide an explicit result: include `create_bank.apply` changes for the step or set `stepOutcome` to `applied` or `no_changes` (with `stepOutcomeNote` for `no_changes`).";
  })();

  return `${prompt}

## Continuation

After completing this step, call \`create_bank\` again with \`iteration: ${iteration + 1}\` and \`stepCompleted: true\`${continuationSuffix}`;
};

const renderDiscoveredSourcesSection = (discoveredSources: readonly ExistingGuidanceSource[]): string => {
  if (discoveredSources.length === 0) {
    return `## Discovered Guidance Sources

No repository-local or provider-project guidance sources were discovered for this project.`;
  }

  return `## Discovered Guidance Sources

${discoveredSources
  .map((source) => `- [${source.kind}${source.scope === "provider-project" && source.provider ? `/${source.provider}` : ""}] ${source.relativePath} (${source.entryType}, ${source.scope})`)
  .join("\n")}`;
};

const renderConfirmedSourceStrategiesSection = (
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[],
): string => {
  if (confirmedSourceStrategies.length === 0) {
    return `## Confirmed Source Strategies

No confirmed source strategies are stored yet for this flow.`;
  }

  return `## Confirmed Source Strategies

${confirmedSourceStrategies
  .map(
    (strategy) =>
      `- ${strategy.sourceRef} -> ${formatGuidanceSourceStrategy(strategy.strategy)}${strategy.note ? ` (${strategy.note})` : ""}`,
  )
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
- build a broad candidate list before the first major write batch: which rule files and which skills appear justified by project evidence
- start writing canonical entries only when the evidence is already strong
- do not import or delete repository-local guidance yet; that review happens in later iterations
- do not stop at a thin summary plan if the repository obviously supports a richer canonical bank

Step output:
- one line per created or updated file
- short purpose for each file or planned file
- note the strongest high-value candidates that still remain open after this step
- major uncertainties or skipped areas that should be handled in later iterations`;

const buildReviewExistingPrompt = (projectPath: string, discoveredSources: readonly ExistingGuidanceSource[]): string => `# Existing Guidance Review

${STABLE_CONTRACT_NOTE}

Review available external guidance before importing anything into Memory Bank.

Project path:
- \`${projectPath}\`

${renderDiscoveredSourcesSection(discoveredSources)}

What to do:
- Build a concise source-level picture of guidance that already exists for this project
- Treat the listed repository-local and provider-project sources as the guaranteed inputs for this review
- If additional provider-global guidance is directly visible in the current agent session, include it in the same review and label it separately
- Treat provider-project guidance as legacy project-specific input that should usually be migrated into Memory Bank, not left as the long-term canonical source
- Do not treat provider-global skills or model-native instructions as a substitute for project or shared Memory Bank coverage
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
- When advancing to the import phase, pass the confirmed decisions back through \`sourceStrategies\` using each source's \`relativePath\` as \`sourceRef\`
- Keep the user-facing review short and action-oriented:
  - start with a 1-2 sentence summary of what sources were found
  - give one recommended default strategy when it is reasonable
  - end with one explicit CTA question telling the user exactly how to answer
  - avoid long protocol dumps or repeating the same source list multiple times
- If one strategy clearly fits most sources, ask for one concise decision first instead of forcing the user through multiple per-source questions

Decision rules:
- Recommend \`project\` scope when the guidance depends on this repository's structure, tooling, or workflow
- Recommend \`shared\` scope when the guidance is clearly reusable across repositories
- If scope is unclear, ask the user explicitly instead of guessing
- Ask for source-level strategy decisions, not per-rule micro-decisions
- Never delete or rewrite any original source during this review step`;

const buildImportSelectedPrompt = (
  discoveredSources: readonly ExistingGuidanceSource[],
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[],
): string => `# Import Selected Guidance

${STABLE_CONTRACT_NOTE}

Apply the source-level strategies the user approved for external guidance.

${renderDiscoveredSourcesSection(discoveredSources)}

${renderConfirmedSourceStrategiesSection(confirmedSourceStrategies)}

What to do:
- For each source the user reviewed, follow the confirmed strategy exactly
- Convert approved guidance into canonical Memory Bank rules and skills
- Split entries between project scope and shared scope when appropriate
- Assign stable ids, titles, topics, and stacks
- Deduplicate against existing Memory Bank content before writing
- Use \`create_bank\` with an \`apply\` payload for batched canonical writes and deletions during this flow
- In \`create_bank.apply\`, paths must be relative to the rules/skills root only; use \`topics/example.md\` or \`adding-feature\`, not \`rules/topics/example.md\` or \`skills/adding-feature\`
- After the user explicitly approves \`move\`, use \`delete_guidance_source\` to remove the original repository-local or provider-project source only after the canonical Memory Bank entries are already written successfully
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
- If the chosen strategy was \`keep source, fill gaps in bank\`, avoid re-copying material that already lives in the source clearly enough
- Do not count provider-global skills or agent-local built-in guidance as existing Memory Bank coverage when deciding what still needs to be written`;

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
- Before applying a major batch, perform a gap review against the strongest remaining candidate rules and skills for this project
- Treat a bank as incomplete if obvious high-value entries are still missing without a clear skip reason
- Do not treat provider-local skills, provider-global skills, or built-in model instructions as a reason to skip project/shared canonical coverage

Quality rules:
- Do not rely on a server-provided file checklist; gather your own evidence from the real repository
- Prefer patterns confirmed by multiple files, configuration, or stable architecture boundaries
- Skip temporary, noisy, or accidental implementation details
- If a candidate rule is high-impact and your confidence is low, ask the user before writing it
- Apply derived changes through \`create_bank.apply\` in batches instead of a long series of one-entry write calls
- In \`create_bank.apply\`, keep each path relative to the rules/skills root instead of prefixing it with \`rules/\` or \`skills/\`
- If \`create_bank.apply\` reports a \`conflict\`, re-read the affected entry, rebuild the full final document, and retry with the fresh \`baseSha256\`
- For each obvious candidate you do not create, keep a short explicit reason: already covered, weak evidence, intentionally deferred, or better suited to shared scope

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
- Run an explicit gap-and-coverage review before declaring the bank done
- Do not treat provider-local skills, provider-global skills, or model-native instructions as a reason to mark a topic or workflow covered

Final pass checklist:
- Remove near-duplicate entries and merge them into the clearest canonical version
- Ensure each entry is either clearly a \`rule\` or clearly a \`skill\`
- Ensure project overrides do not duplicate shared guidance without adding real specificity
- Leave unresolved or low-confidence items out unless the user explicitly approves them
- Confirm the bank is not materially poorer than the strongest project evidence that was available during this run
- Check whether high-value topics were considered where applicable: architecture, routing, state/data flow, services/API, styling, i18n, SSR/browser boundaries, testing, performance
- Check whether high-value skills were considered where applicable: adding-feature, adding-service, code-review, task-based-reading, troubleshooting, common-anti-patterns, and stack-specific workflows
- If any obvious candidate was skipped, keep the clearest reason rather than silently omitting it
- In the final report, mention imported sources, newly derived entries, and any important skipped uncertainties or intentionally omitted candidates
- If you finish with \`stepOutcome: "no_changes"\`, use \`stepOutcomeNote\` to summarize the strongest skipped or already-covered high-value candidates and why no further mutation was needed`;

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
  ({ discoveredSources, confirmedSourceStrategies }) => buildImportSelectedPrompt(discoveredSources, confirmedSourceStrategies),
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
  confirmedSourceStrategies,
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
    confirmedSourceStrategies,
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
