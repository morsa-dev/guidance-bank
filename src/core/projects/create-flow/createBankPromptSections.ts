import type { DetectableStack, ReferenceProjectCandidate } from "../../context/types.js";

import { requiresCreateFlowStepOutcome } from "./createFlowPhases.js";
import { renderCreateDeriveGuidance } from "./createBankDeriveGuidance/index.js";
import type { CurrentProjectBankSnapshot } from "../discoverCurrentProjectBank.js";
import type { ExistingGuidanceSource } from "../discoverExistingGuidance.js";
import {
  formatSourceReviewDecision,
  type ConfirmedGuidanceSourceStrategy,
} from "./guidanceStrategies.js";
import type { PendingSourceReviewBucket } from "./sourceReviewBuckets.js";

const STABLE_CONTRACT_NOTE = `Use \`phase\` as the main guide for the current create step and treat \`iteration\` as diagnostic only. If \`creationPrompt\` is present, use it as the stable create-flow contract; this step prompt contains only the incremental instruction for the current phase.`;

const renderConfirmedSourceStrategiesSection = (
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[],
  discoveredSources: readonly ExistingGuidanceSource[],
): string => {
  if (confirmedSourceStrategies.length === 0) {
    return `## Confirmed Source Decisions

No confirmed source decisions are stored yet for this flow.`;
  }

  const sourcesByRef = new Map(discoveredSources.map((source) => [source.relativePath, source]));

  return `## Confirmed Source Decisions

${confirmedSourceStrategies
  .map((strategy) => {
    const source = sourcesByRef.get(strategy.sourceRef);
    const sourceDetails = source
      ? ` [${source.scope}${source.provider ? `/${source.provider}` : ""}, ${source.entryType}] \`${source.path}\``
      : "";

    return `- ${strategy.sourceRef}${sourceDetails} -> ${formatSourceReviewDecision(strategy.decision, strategy.cleanupAllowed)}${strategy.note ? ` (${strategy.note})` : ""}`;
  })
  .join("\n")}`;
};

const renderPendingReviewBucketSection = (pendingBucket: PendingSourceReviewBucket | null): string => {
  if (pendingBucket === null) {
    return `## Pending Review Bucket

No unresolved external-guidance review bucket remains.`;
  }

  const providerLine =
    pendingBucket.providers.length > 0 ? `- Providers in this bucket: ${pendingBucket.providers.join(", ")}` : "";

  const shownSources = pendingBucket.sources.slice(0, 12);
  const sourceLimitLine =
    pendingBucket.sources.length > shownSources.length
      ? `- Showing first ${shownSources.length} of ${pendingBucket.sources.length} sources; inspect the full \`pendingSourceReviewBuckets[0].sources\` structured field if needed.`
      : "";

  return `## Pending Review Bucket

- Bucket: \`${pendingBucket.bucket}\`
- Title: ${pendingBucket.title}
- Scope summary: ${pendingBucket.promptLabel}
- Source count: ${pendingBucket.sourceCount} (${pendingBucket.fileCount} files, ${pendingBucket.directoryCount} directories)
${providerLine}
- Sources to review:
${shownSources
  .map(
    (source) =>
      `  - [${source.entryType}] ${source.sourceRef}${source.provider ? ` (${source.provider})` : ""}: \`${source.path}\``,
  )
  .join("\n")}
${sourceLimitLine}`;
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

const LEGACY_CLEANUP_CONTRACT = `## Cleanup Rules

- The agent must inspect source content and decide what useful guidance exists; the server does not preselect semantic candidates
- Delete a whole legacy source only when the imported guidance fully replaced it and the confirmed decision has \`cleanupAllowed: true\`
- For mixed sources, keep the remaining source content in place unless a precise partial cleanup is available
- Never delete provider-global sources during this flow
- In the report, mention any mixed source that still contains non-imported content after import`;

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
  pendingSourceReviewBuckets,
}: {
  projectPath: string;
  pendingSourceReviewBuckets: readonly PendingSourceReviewBucket[];
}): string => {
  const pendingBucket = pendingSourceReviewBuckets[0] ?? null;

  return `# Existing Guidance Review

${STABLE_CONTRACT_NOTE}

Review available external guidance before importing anything into AI Guidance Bank.

Project path:
- \`${projectPath}\`

${renderPendingReviewBucketSection(pendingBucket)}

What to do:
- Review one pending bucket at a time
- Treat the source list as discovery only; inspect the source content yourself before importing anything
- Treat AI Guidance Bank as the durable canonical rules-and-skills layer for the project
- Ask for one explicit decision for the current pending bucket only:
  - \`import_to_bank\`: centralize useful guidance from this bucket into AI Guidance Bank
  - \`keep_external\`: leave this bucket provider-native/local and do not import it
- Record the answer with \`sourceReviewBucket: "${pendingBucket?.bucket ?? "provider-global"}"\` and \`sourceReviewDecision: "import_to_bank" | "keep_external"\`
- Keep the user-facing review short:
  - summarize the bucket in 1-2 sentences
  - end with one CTA asking whether to import to bank or keep external
  - do not dump the full protocol or raw source inventory`;
};

export const buildImportSelectedPrompt = ({
  confirmedSourceStrategies,
  discoveredSources,
}: {
  confirmedSourceStrategies: readonly ConfirmedGuidanceSourceStrategy[];
  discoveredSources: readonly ExistingGuidanceSource[];
}): string => `# Import Selected Guidance

${STABLE_CONTRACT_NOTE}

Apply the confirmed source decisions. The agent, not the server, decides which guidance inside each approved source is useful.

${renderConfirmedSourceStrategiesSection(confirmedSourceStrategies, discoveredSources)}

${LEGACY_CLEANUP_CONTRACT}

What to do:
- Read each source confirmed as \`import_to_bank\`
- Import only useful non-duplicate guidance from approved sources
- If a source was kept external, treat it as existing external coverage and do not duplicate it during later project derivation
- Keep the import focused on rules and skills, not raw source-file restatement
- Use \`scope: "shared"\` for reusable provider-independent guidance and \`scope: "project"\` for repository-specific guidance
- Prefer a small number of strong canonical entries over fragmented copies
- Use \`create_bank.apply\` for batched canonical writes
- In \`create_bank.apply\`, paths must be relative to the rules/skills root only
- For mixed sources, keep the original source in place unless you can safely trim only the imported guidance
- For fully replaced repository-local or provider-project sources, use \`delete_guidance_source\` only after the canonical write is verified
- Never call \`delete_guidance_source\` for provider-global sources
- If \`create_bank.apply\` reports a \`conflict\`, re-read the affected entry and retry with a fresh \`baseSha256\``;

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
- Confirm no imported provider-project or repository-local guidance source still duplicates canonical bank content; call \`delete_guidance_source\` only when the source was fully replaced and the user-approved bucket was imported to the bank, or name why it must remain
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
