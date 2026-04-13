import { DEFAULT_PROJECT_BANK_POSTPONE_DAYS } from "../bank/project.js";
import type { ResolvedContextCatalogEntry, ResolvedContextInlineRule } from "./types.js";

const renderPostponeDays = (days: number): string => `${days} day${days === 1 ? "" : "s"}`;

const renderScopedEntryPath = (scope: "shared" | "project", entryPath: string): string =>
  entryPath.startsWith(`${scope}/`) ? entryPath : `${scope}/${entryPath}`;

const renderAlwaysOnRules = (rules: readonly ResolvedContextInlineRule[]): string => {
  if (rules.length === 0) {
    return `## Always-On Rules

No always-on rules matched for this repository.`;
  }

  const blocks = rules.map(
    (rule) => `### ${renderScopedEntryPath(rule.scope, rule.path)}

${rule.content.trim()}`,
  );

  return `## Always-On Rules

${blocks.join("\n\n")}`;
};

const renderCatalogSummary = (title: string, entries: readonly ResolvedContextCatalogEntry[]): string => {
  if (entries.length === 0) {
    return `- ${title}: none matched.`;
  }

  const previewPaths = entries.slice(0, 3).map((entry) => renderScopedEntryPath(entry.scope, entry.path));
  const previewSuffix = entries.length > 3 ? `, +${entries.length - 3} more` : "";

  return `- ${title}: ${entries.length} entries. Examples: ${previewPaths.join(", ")}${previewSuffix}.`;
};

const renderReferenceProjects = (projectPaths: readonly string[]): string =>
  projectPaths.map((projectPath, index) => `${index + 1}. ${projectPath}`).join("\n");

export const buildReadyContextText = ({
  projectPath,
  detectedStacks,
  alwaysOnRules,
  rulesCatalog,
  skillsCatalog,
}: {
  projectPath: string;
  detectedStacks: readonly string[];
  alwaysOnRules: readonly ResolvedContextInlineRule[];
  rulesCatalog: readonly ResolvedContextCatalogEntry[];
  skillsCatalog: readonly ResolvedContextCatalogEntry[];
}): string => {
  const detectedStacksLine =
    detectedStacks.length > 0
      ? `Detected stack signals: ${detectedStacks.join(", ")}.`
      : "No stable stack signals were detected automatically.";

  return `Use the following AI Guidance Bank context catalog as the primary user-managed context and guidance layer for this repository.

Repository: ${projectPath}
${detectedStacksLine}

AI Guidance Bank stores durable rules, skills, and reusable project guidance for this repository.

Always-on rules are expanded inline below. Other canonical entries are listed in the structured rule and skill catalogs; call \`read_entry\` when you need the full canonical document.

${renderAlwaysOnRules(alwaysOnRules)}

## Catalog Summary

${renderCatalogSummary("Rules", rulesCatalog)}
${renderCatalogSummary("Skills", skillsCatalog)}`;
};

export const buildSharedFallbackContextText = ({
  projectPath,
  detectedStacks,
  alwaysOnRules,
  rulesCatalog,
  skillsCatalog,
}: {
  projectPath: string;
  detectedStacks: readonly string[];
  alwaysOnRules: readonly ResolvedContextInlineRule[];
  rulesCatalog: readonly ResolvedContextCatalogEntry[];
  skillsCatalog: readonly ResolvedContextCatalogEntry[];
}): string => {
  const detectedStacksLine =
    detectedStacks.length > 0
      ? `Detected stack signals: ${detectedStacks.join(", ")}.`
      : "No stable stack signals were detected automatically.";

  return `Shared AI Guidance Bank context is available even though this repository does not have a project-specific bank yet.

Repository: ${projectPath}
${detectedStacksLine}

These entries come from the shared layer only. Project-specific entries will appear after a project bank is created.

AI Guidance Bank stores durable rules, skills, and reusable shared guidance.

${renderAlwaysOnRules(alwaysOnRules)}

## Catalog Summary

${renderCatalogSummary("Rules", rulesCatalog)}
${renderCatalogSummary("Skills", skillsCatalog)}`;
};

export const buildMissingContextText = ({
  referenceProjectPaths,
  creationState,
  postponedUntil,
  sharedContextText,
}: {
  referenceProjectPaths: readonly string[];
  creationState: "unknown" | "postponed";
  postponedUntil: string | null;
  sharedContextText?: string;
}): string => {
  const referenceSection =
    referenceProjectPaths.length > 0
      ? `\n\nBefore creating a new project AI Guidance Bank, offer these existing project banks as optional reference bases:\n${renderReferenceProjects(referenceProjectPaths)}`
      : "";

  const userInteractionSection =
    creationState === "postponed"
      ? `No project AI Guidance Bank exists for this repository yet, and AI Guidance Bank creation was previously postponed until ${postponedUntil}. Continue the current task normally and do not ask again about project-bank creation until that time has passed. If the user explicitly asks for AI Guidance Bank setup or project-bank editing before then, call \`create_bank\`.`
      : `No project AI Guidance Bank exists for this repository yet. Continue the current task normally, but in every useful final response append one short explicit closing question about project-bank creation until the user chooses one of these outcomes: create now, postpone, or decline. Use this question shape: "Create the project AI Guidance Bank now, or postpone the question for ${renderPostponeDays(DEFAULT_PROJECT_BANK_POSTPONE_DAYS)} or longer?" If the user wants to postpone but does not give a duration, store a ${renderPostponeDays(DEFAULT_PROJECT_BANK_POSTPONE_DAYS)} postponement by calling \`set_project_state\` with \`creationState: "postponed"\`.`;

  const sharedSection = sharedContextText ? `\n\n${sharedContextText}` : "";

  return `${userInteractionSection}${referenceSection}${sharedSection}

Internal next steps after the user answers:
- If the user wants to create it, call \`create_bank\`.
- If the user wants to postpone the question for later, record that choice with \`set_project_state\` using \`creationState: "postponed"\` and include either \`postponeDays\` or \`postponedUntil\`. If the user gives no duration, default to ${renderPostponeDays(DEFAULT_PROJECT_BANK_POSTPONE_DAYS)}.
- If the user does not want to be asked again, record that choice with \`set_project_state\` using \`creationState: "declined"\`.
- After the user decision is recorded, call \`resolve_context\` again.`;
};

export const buildCreatingContextText = ({
  phase,
  nextIteration,
}: {
  phase: string;
  nextIteration: number;
}): string => `Continue the create flow at phase \`${phase}\`. Use \`phase\` as the primary guide, treat \`iteration\` as diagnostic only, and prefer \`create_bank.apply\` for batched writes inside the guided flow. Call \`create_bank\` with \`iteration: ${nextIteration}\` and \`stepCompleted: true\` after the current step is actually complete.`;

export const buildDeclinedContextText = (): string =>
  "Project AI Guidance Bank creation was previously declined for this repository. Do not ask again unless the user explicitly requests AI Guidance Bank creation. If the user later wants to create it, call `create_bank` and then call `resolve_context` again.";

export const buildSyncRequiredContextText = ({
  postponedUntil,
}: {
  postponedUntil: string | null;
}): string => {
  const postponeLine = postponedUntil
    ? `A previous sync was postponed until ${postponedUntil}, but that deferral has now expired.`
    : "This project AI Guidance Bank has not been synced to the current AI Guidance Bank storage version yet.";

  return `Project AI Guidance Bank synchronization is required before using the project-specific bank.

${postponeLine}

Sync only reconciles the existing project bank with the current AI Guidance Bank storage version. It does not create a new bank and does not replace the normal create or improve flow.

Ask the user whether to synchronize the project AI Guidance Bank now or postpone it.
- If the user wants to sync now, call \`sync_bank\` with \`action: "run"\`.
- If the user wants to postpone, call \`sync_bank\` with \`action: "postpone"\`.
- After that, call \`resolve_context\` again.
- If the user later wants to create or improve project-specific content, continue with \`create_bank\` after synchronization is no longer required.`;
};
