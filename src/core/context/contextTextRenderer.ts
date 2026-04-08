import type { ResolvedContextCatalogEntry, ResolvedContextInlineRule } from "./types.js";

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

const renderCatalogEntry = (entry: ResolvedContextCatalogEntry): string => {
  const stacks = entry.stacks.length > 0 ? `stacks: ${entry.stacks.join(", ")}` : "always-on";
  const topics = entry.topics.length > 0 ? `topics: ${entry.topics.join(", ")}` : "topics: none";
  const detail = entry.kind === "skills" ? entry.description ?? "No description." : entry.preview ?? "No preview.";

  return `- ${renderScopedEntryPath(entry.scope, entry.path)} (${entry.id}) — ${entry.title}. ${stacks}; ${topics}. ${detail}`;
};

const renderCatalogSection = (title: string, entries: readonly ResolvedContextCatalogEntry[]): string => {
  if (entries.length === 0) {
    return `## ${title}

No ${title.toLowerCase()} matched for this repository.`;
  }

  return `## ${title}

${entries.map(renderCatalogEntry).join("\n")}`;
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

  return `Use the following Memory Bank context catalog as the primary user-managed context for this repository.

Repository: ${projectPath}
${detectedStacksLine}

Always-on rules are expanded inline below. For other rules and skills, use the catalogs and call \`read_entry\` when you need the full canonical document.

${renderAlwaysOnRules(alwaysOnRules)}

${renderCatalogSection("Rule Catalog", rulesCatalog)}

${renderCatalogSection("Skill Catalog", skillsCatalog)}`;
};

export const buildMissingContextText = ({
  referenceProjectPaths,
  creationState,
}: {
  referenceProjectPaths: readonly string[];
  creationState: "unknown" | "postponed";
}): string => {
  const referenceSection =
    referenceProjectPaths.length > 0
      ? `\n\nBefore creating a new project Memory Bank, offer these existing project banks as optional reference bases:\n${renderReferenceProjects(referenceProjectPaths)}`
      : "";

  const userInteractionSection =
    creationState === "postponed"
      ? `No project Memory Bank exists for this repository yet, and Memory Bank creation was previously postponed. Continue the current task normally and do not interrupt the user just to ask again. If the user explicitly asks for Memory Bank setup or project-bank editing, call \`create_bank\`.`
      : `No project Memory Bank exists for this repository yet. Continue the current task normally; do not interrupt the user just to ask about Memory Bank creation. If it fits naturally after your current useful response, add one short note that a project Memory Bank can be created now or postponed for later.`;

  return `${userInteractionSection}${referenceSection}

Internal next steps after the user answers:
- If the user wants to create it, call \`create_bank\`.
- If the user wants to postpone the question for later, record that choice with \`set_project_state\` using \`creationState: "postponed"\`.
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
  "Project Memory Bank creation was previously declined for this repository. Do not ask again unless the user explicitly requests Memory Bank creation. If the user later wants to create it, call `create_bank` and then call `resolve_context` again.";

export const buildSyncRequiredContextText = ({
  postponedUntil,
}: {
  postponedUntil: string | null;
}): string => {
  const postponeLine = postponedUntil
    ? `A previous sync was postponed until ${postponedUntil}, but that deferral has now expired.`
    : "This project Memory Bank has not been synced to the current Memory Bank storage version yet.";

  return `Project Memory Bank synchronization is required before using the project-specific bank.

${postponeLine}

Sync only reconciles the existing project bank with the current Memory Bank storage version. It does not create a new bank and does not replace the normal create or improve flow.

Ask the user whether to synchronize the project Memory Bank now or postpone it.
- If the user wants to sync now, call \`sync_bank\` with \`action: "run"\`.
- If the user wants to postpone, call \`sync_bank\` with \`action: "postpone"\`.
- After that, call \`resolve_context\` again.
- If the user later wants to create or improve project-specific content, continue with \`create_bank\` after synchronization is no longer required.`;
};
