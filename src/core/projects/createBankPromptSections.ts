import type { DetectableStack, ReferenceProjectCandidate } from "../context/types.js";

import { requiresCreateFlowStepOutcome } from "./createFlowPhases.js";
import { renderCreateDeriveGuidance } from "./createBankDeriveGuidance/index.js";
import type { CurrentProjectBankSnapshot } from "./discoverCurrentProjectBank.js";
import type { ExistingGuidanceSource } from "./discoverExistingGuidance.js";
import {
  formatGuidanceSourceStrategy,
  type ConfirmedGuidanceSourceStrategy,
} from "./guidanceStrategies.js";
import type { PendingSourceReviewBucket } from "./sourceReviewBuckets.js";

const STABLE_CONTRACT_NOTE = `Use \`phase\` as the main guide for the current create step and treat \`iteration\` as diagnostic only. If \`creationPrompt\` is present, use it as the stable create-flow contract; this step prompt contains only the incremental instruction for the current phase.`;

const renderDiscoveredSourcesSection = (discoveredSources: readonly ExistingGuidanceSource[]): string => {
  if (discoveredSources.length === 0) {
    return `## Discovered Guidance Sources

No repository-local, provider-project, or provider-global guidance sources were discovered for this project.`;
  }

  return `## Discovered Guidance Sources

${discoveredSources
  .map((source) => `- [${source.kind}${source.scope !== "repository-local" && source.provider ? `/${source.provider}` : ""}] ${source.relativePath} (${source.entryType}, ${source.scope})`)
  .join("\n")}`;
};

const renderConfirmedSourceStrategiesSection = (
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[],
): string => {
  if (confirmedSourceStrategies.length === 0) {
    return `## Confirmed Source Decisions

No confirmed source decisions are stored yet for this flow.`;
  }

  return `## Confirmed Source Decisions

${confirmedSourceStrategies
  .map(
    (strategy) =>
      `- ${strategy.sourceRef} -> ${formatGuidanceSourceStrategy(strategy.strategy)}${strategy.note ? ` (${strategy.note})` : ""}`,
  )
  .join("\n")}`;
};

const renderPendingReviewBucketSection = (pendingBucket: PendingSourceReviewBucket | null): string => {
  if (pendingBucket === null) {
    return `## Pending Review Bucket

No unresolved external-guidance review bucket remains.`;
  }

  const providerLine =
    pendingBucket.providers.length > 0 ? `- Providers in this bucket: ${pendingBucket.providers.join(", ")}` : "";

  return `## Pending Review Bucket

- Bucket: \`${pendingBucket.bucket}\`
- Title: ${pendingBucket.title}
- Scope summary: ${pendingBucket.promptLabel}
${providerLine}
- Sources:
${pendingBucket.sources.map((sourceRef) => `  - ${sourceRef}`).join("\n")}`;
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

const LEGACY_CLEANUP_CONTRACT = `## Legacy Source Cleanup Contract

AI Guidance Bank is the canonical guidance layer after the user approves \`migrate\` for a review bucket.

- A confirmed \`move\` decision means: migrate the useful source content into AI Guidance Bank, verify the canonical write, then remove the migrated legacy source with \`delete_guidance_source\`
- Use \`delete_guidance_source\` for both repository-local sources and provider-project sources such as Codex project skills
- Provider-global sources are different: import useful provider-independent guidance into shared AI Guidance Bank, remember the decision, and keep the provider-global source in place unless the user explicitly approves cleanup for that source
- Delete only discovered source paths that were fully migrated or made obsolete by stronger canonical bank entries
- Leave a source in place when it contains unmigrated material, when deletion was not approved, or when it is a container that still holds non-migrated files
- In the step outcome or final report, name any migrated source that remains in the provider/repository layer and explain why it was intentionally kept`;

const buildContinuationOutcomeInstruction = (iteration: number): string => {
  if (!requiresCreateFlowStepOutcome(iteration)) {
    return "";
  }

  const baseInstruction =
    " Also provide an explicit result for this content phase: use `create_bank.apply` for changes or set `stepOutcome` to `applied` or `no_changes`.";

  if (iteration === 3) {
    return `${baseInstruction} If you use \`no_changes\`, use \`stepOutcomeNote\` to name the strongest remaining candidates and coverage categories you reviewed and why they were skipped.`;
  }

  if (iteration === 4) {
    return `${baseInstruction} If you use \`no_changes\`, use \`stepOutcomeNote\` to summarize the strongest skipped or already-covered candidates, the coverage categories they belong to, and why the bank is complete enough.`;
  }

  return `${baseInstruction} If you use \`no_changes\`, include \`stepOutcomeNote\`.`;
};

export const appendContinuationInstruction = (prompt: string, iteration: number): string => {
  const continuationSuffix = buildContinuationOutcomeInstruction(iteration);

  return `${prompt}

## Continuation

After completing this step, call \`create_bank\` again with \`iteration: ${iteration + 1}\` and \`stepCompleted: true\`.${continuationSuffix}`;
};

export const renderExistingBankBaselineSection = (
  currentBankSnapshot: CurrentProjectBankSnapshot,
): string => `## Current Bank Baseline

A project AI Guidance Bank already exists for this repository. Treat the current project bank as the canonical baseline and improve it instead of recreating it blindly.

- Current project bank inventory: ${currentBankSnapshot.entries.length} entr${currentBankSnapshot.entries.length === 1 ? "y" : "ies"}.
- Reuse strong existing entries
- Prefer updating or replacing weak entries over duplicating them
- Remove stale or overlapping entries only when there is clear evidence and the user approves destructive changes
- Use \`list_entries\` and \`read_entry\` with \`scope: "project"\` and the current \`projectPath\` when you need the full text of an existing project-bank entry
`;

export const buildKickoffPrompt = ({
  projectName,
  projectPath,
  projectBankPath,
  rulesDirectory,
  skillsDirectory,
  detectedStacks,
  selectedReferenceProjects,
}: {
  projectName: string;
  projectPath: string;
  projectBankPath: string;
  rulesDirectory: string;
  skillsDirectory: string;
  detectedStacks: readonly DetectableStack[];
  selectedReferenceProjects: readonly ReferenceProjectCandidate[];
}): string => `# Create Flow Kickoff

${STABLE_CONTRACT_NOTE}

Project:
- \`${projectName}\`
- \`${projectPath}\`

Target AI Guidance Bank:
- \`${projectBankPath}\`
- Rules: \`${rulesDirectory}\`
- Skills: \`${skillsDirectory}\`

${renderDetectedStacksSection(detectedStacks)}

${renderReferenceProjectsSection(selectedReferenceProjects)}

What to do in this step:
- inspect the repository and selected reference projects
- form a candidate list for the first high-value rules and skills
- start writing only when the evidence is already strong
- delay external guidance import or deletion until the dedicated review step
- treat AI Guidance Bank as durable, reusable rules-and-skills guidance across sessions
- do not stop at a thin summary if the repository clearly supports a richer bank

Step output:
- short list of created, updated, or planned files
- short purpose for each item
- strongest remaining candidates or uncertainties to handle next`;

export const buildReviewExistingPrompt = ({
  projectPath,
  discoveredSources,
  pendingSourceReviewBuckets,
}: {
  projectPath: string;
  discoveredSources: readonly ExistingGuidanceSource[];
  pendingSourceReviewBuckets: readonly PendingSourceReviewBucket[];
}): string => {
  const pendingBucket = pendingSourceReviewBuckets[0] ?? null;

  return `# Existing Guidance Review

${STABLE_CONTRACT_NOTE}

Review available external guidance before importing anything into AI Guidance Bank.

Project path:
- \`${projectPath}\`

${renderDiscoveredSourcesSection(discoveredSources)}
${renderPendingReviewBucketSection(pendingBucket)}

What to do:
- Treat the listed repository-local, provider-project, and provider-global sources as the guaranteed inputs for this review
- Review one pending bucket at a time, in this order when available: \`repository-local\`, \`provider-project\`, \`provider-global\`
- Skip purely empty, obsolete, or trivial sources without bothering the user
- By default, do not expose internal strategy labels to the user
- Treat AI Guidance Bank as the durable canonical rules-and-skills layer for the project
- Ask for one explicit decision for the current pending bucket only:
  - \`migrate\`: import useful non-duplicate guidance from this bucket into AI Guidance Bank
  - \`keep\`: do not import guidance from this bucket and leave the legacy sources in place
- Record the answer with \`sourceReviewBucket: "${pendingBucket?.bucket ?? "repository-local"}"\` and \`sourceReviewDecision: "migrate" | "keep"\`
- Keep the user-facing review short and action-oriented:
  - start with a 1-2 sentence summary of the current pending bucket
  - recommend one default action
  - end with one explicit CTA question telling the user to answer \`migrate\` or \`keep\`
  - avoid long protocol dumps, source-strategy labels, or repeating the same source list multiple times

Decision rules:
- Treat provider-project guidance as legacy project-specific input that usually needs review or migration
- Treat provider-global guidance as user-level provider-native input that may affect this project and should usually be imported into shared AI Guidance Bank when it is provider-independent
- Treat Cursor and Claude project guidance in the repository itself as repository-local sources, not provider-project sources
- Do not inspect, import, or delete provider-project guidance for other projects
- Do not delete provider-global guidance during this review step; cleanup of provider-global sources requires a separate explicit user decision after migration
- Never delete or rewrite any original source during this review step`;
};

export const buildImportSelectedPrompt = ({
  discoveredSources,
  confirmedSourceStrategies,
}: {
  discoveredSources: readonly ExistingGuidanceSource[];
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[];
}): string => `# Import Selected Guidance

${STABLE_CONTRACT_NOTE}

Apply the source-level strategies the user approved for external guidance.

${renderDiscoveredSourcesSection(discoveredSources)}

${renderConfirmedSourceStrategiesSection(confirmedSourceStrategies)}

${LEGACY_CLEANUP_CONTRACT}

What to do:
- Treat the confirmed source decisions below as the internal execution plan for this import step
- Convert approved guidance into canonical AI Guidance Bank rules and skills
- Keep imported content durable, operational, and reusable across future sessions
- Split entries between project scope and shared scope when appropriate
- Write reusable cross-project rules or skills to \`scope: "shared"\`; write repository-specific conventions, paths, workflows, and architecture boundaries to \`scope: "project"\`
- Assign stable ids, titles, topics, and stack metadata
- Deduplicate against existing AI Guidance Bank content before writing
- Use \`create_bank\` with an \`apply\` payload for batched canonical writes and deletions during this flow
- In \`create_bank.apply\`, paths must be relative to the rules/skills root only; use \`example.md\` or \`adding-feature\`, not \`rules/example.md\` or \`skills/adding-feature\`
- For sources confirmed by \`migrate\`, import useful non-duplicate file-level guidance, ignore empty or container-only sources automatically, and clean up migrated repository-local or provider-project legacy files when it is safe to do so after successful writes and verification
- For provider-global sources confirmed by \`migrate\`, import useful provider-independent guidance into \`scope: "shared"\`, remember the decision, and keep the provider-global source in place unless the user separately approves cleanup
- For sources confirmed by \`keep\`, do not migrate those sources in this pass; leave them in place and rely on the persisted decision to avoid repeated prompts until content changes
- For each confirmed \`move\` source that was successfully migrated, call \`delete_guidance_source\` with the discovered absolute \`sourcePath\` after the canonical write is verified
- Never call \`delete_guidance_source\` for provider-global sources unless the user explicitly approved cleanup for that specific provider-global source
- When replacing or deleting an existing AI Guidance Bank entry, read it first and pass its \`sha256\` back as \`baseSha256\`
- If \`create_bank.apply\` reports a \`conflict\`, re-read the affected entry, rebuild the full final document, and retry with the fresh \`baseSha256\`

Write rules:
- Create a \`rule\` when the source describes a stable constraint, convention, or preference
- Create a \`skill\` when the source describes a reusable workflow or task sequence
- Prefer a small number of high-value entries over fragmented boilerplate
- If a source duplicates existing canonical content, update or skip instead of cloning it

Safety rules:
- Do not delete, rewrite, or trim any original source unless the confirmed review decision allows cleanup and the migration was already written and verified successfully
- If the user did not clearly approve an action for a source, leave that source untouched
- If one source mixes project-specific and shared material, split it across scopes instead of forcing one destination
- Do not count provider-local or provider-global guidance as existing AI Guidance Bank coverage when deciding what still needs to be written
- Do not import or delete provider-project guidance belonging to other projects`;

export const buildDeriveFromProjectPrompt = ({
  projectPath,
  detectedStacks,
}: {
  projectPath: string;
  detectedStacks: readonly DetectableStack[];
}): string => `# Derive From Project

${STABLE_CONTRACT_NOTE}

Derive additional AI Guidance Bank entries from the real repository.

Project path:
- \`${projectPath}\`

What to do:
- Inspect the real repository directly: project structure, entrypoints, configuration, source files, and recurring implementation patterns
- Create a focused set of high-value project rules and skills
- Prefer stable patterns over one-off details
- Keep AI Guidance Bank focused on durable guidance that remains useful across future sessions
- Put reusable cross-project guidance into shared scope only when the evidence is strong
- Infer the project archetype from the real repository and adapt the candidate set to it before writing
- Review the strongest remaining candidates before a major batch
- Treat the bank as incomplete if obvious entries are still missing without a clear skip reason

Quality rules:
- Do not rely on a server-provided file checklist; gather your own evidence from the real repository
- Prefer patterns confirmed by multiple files, configuration, or stable architecture boundaries
- Skip temporary, noisy, or accidental implementation details
- If a candidate rule is high-impact and your confidence is low, ask the user before writing it
- Apply derived changes through \`create_bank.apply\` in batches instead of a long series of one-entry write calls
- In \`create_bank.apply\`, keep each path relative to the rules/skills root instead of prefixing it with \`rules/\` or \`skills/\`
- If \`create_bank.apply\` reports a \`conflict\`, re-read the affected entry, rebuild the full final document, and retry with the fresh \`baseSha256\`
- For each obvious candidate you skip, keep a short reason: already covered, weak evidence, intentionally deferred, or better suited to shared scope

${renderCreateDeriveGuidance(detectedStacks)}`;

export const buildFinalizePrompt = (): string => `# Finalize AI Guidance Bank

${STABLE_CONTRACT_NOTE}

Finish the project AI Guidance Bank creation flow.

${LEGACY_CLEANUP_CONTRACT}

What to do:
- Deduplicate overlapping rules and skills
- Verify scope split between shared and project entries
- Check ids, titles, topics, and stack metadata for consistency
- Keep only durable guidance that should survive across sessions; leave conversational context out
- If confidence is low for any high-impact rule, ask the user before keeping it
- Use \`create_bank.apply\` for the final cleanup batch when you need to replace or delete multiple entries
- If \`create_bank.apply\` reports a \`conflict\`, re-read the affected entry, rebuild the final canonical document, and retry the cleanup batch with fresh \`baseSha256\`
- Return a concise completion report when the bank is in a good canonical state
- Run an explicit gap-and-coverage review before declaring the bank done

Final pass checklist:
- Remove near-duplicate entries and merge them into the clearest canonical version
- Ensure each entry is either clearly a \`rule\` or clearly a \`skill\`
- Ensure project overrides do not duplicate shared guidance without adding real specificity
- Move entries into shared scope when they are provider-independent and likely useful across repositories; keep project scope for guidance tied to this repository's files, commands, stack versions, or architecture
- Leave unresolved or low-confidence items out unless the user explicitly approves them
- Confirm the bank is not materially poorer than the strongest project evidence from this run
- For each high-value area identified during derive, confirm whether it is covered by a project entry, covered well enough by shared guidance, or intentionally skipped with a short reason
- Confirm no migrated provider-project guidance source still duplicates canonical bank content; if one does, call \`delete_guidance_source\` when the approved strategy was \`move\`, or name why it must remain
- Confirm provider-global sources that affect this project were either imported into shared AI Guidance Bank, intentionally kept provider-native by remembered decision, or skipped with a short reason
- Stop only when additional entries would mostly duplicate existing guidance, restate weak evidence, or split the bank into overly fine-grained fragments
- Check the strongest applicable topic and skill candidates, then create them, merge them, or record a skip reason
- In the final report, mention imported sources, newly derived entries, and any important skipped uncertainties or intentionally omitted candidates
- If you finish with \`stepOutcome: "no_changes"\`, use \`stepOutcomeNote\` to summarize the strongest skipped or already-covered high-value candidates, their coverage categories, and why no further mutation was needed`;

export const buildCompletedPrompt = (): string => `# Create Flow Completed

The iterative project AI Guidance Bank creation flow is complete.

What to do:
- Do not continue the create flow automatically
- Re-enter the flow only if the user explicitly asks for another create pass or wants to restart parts of the review
- Continue normal AI Guidance Bank work through the standard mutation tools when the user asks for targeted updates`;

export const buildReadyProjectBankPrompt = ({
  updatedAt,
  updatedDaysAgo,
}: {
  updatedAt: string | null;
  updatedDaysAgo: number | null;
}): string => {
  const updatedLine =
    updatedAt === null || updatedDaysAgo === null
      ? "A project AI Guidance Bank already exists for this repository."
      : `A project AI Guidance Bank already exists for this repository and was last updated ${updatedDaysAgo} day${updatedDaysAgo === 1 ? "" : "s"} ago (${updatedAt}).`;

  return `# Existing Project AI Guidance Bank

${updatedLine}

What to do:
- Tell the user that a project AI Guidance Bank already exists for this repository
- Ask whether they want to improve it now instead of keeping it as-is
- If the user wants to improve it, call \`create_bank\` again with \`iteration: 1\`
- If the user does not want to improve it, continue normal work with the current ready bank through \`resolve_context\`
- If you continue into later create iterations, treat the existing project bank as the canonical baseline and improve gaps, stale entries, duplicates, and weak coverage instead of recreating the bank from scratch`;
};
