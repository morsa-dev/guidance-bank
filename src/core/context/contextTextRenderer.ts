import type { ResolvedContextEntry } from "./types.js";

const renderEntrySection = (title: string, entries: readonly ResolvedContextEntry[]): string => {
  if (entries.length === 0) {
    return `## ${title}

No ${title.toLowerCase()} matched for this repository.`;
  }

  const blocks = entries.map(
    (entry) => `### ${entry.layer}/${entry.path}

${entry.content.trim()}`,
  );

  return `## ${title}

${blocks.join("\n\n")}`;
};

const renderReferenceProjects = (projectPaths: readonly string[]): string =>
  projectPaths.map((projectPath, index) => `${index + 1}. ${projectPath}`).join("\n");

export const buildReadyContextText = ({
  projectPath,
  detectedStacks,
  rules,
  skills,
}: {
  projectPath: string;
  detectedStacks: readonly string[];
  rules: readonly ResolvedContextEntry[];
  skills: readonly ResolvedContextEntry[];
}): string => {
  const detectedStacksLine =
    detectedStacks.length > 0
      ? `Detected stack signals: ${detectedStacks.join(", ")}.`
      : "No stable stack signals were detected automatically.";

  return `Use the following Memory Bank context as the primary user-managed context for this repository.

Repository: ${projectPath}
${detectedStacksLine}

${renderEntrySection("Rules", rules)}

${renderEntrySection("Skills", skills)}`;
};

export const buildMissingContextText = ({
  referenceProjectPaths,
}: {
  referenceProjectPaths: readonly string[];
}): string => {
  const referenceSection =
    referenceProjectPaths.length > 0
      ? `\n\nBefore creating a new project Memory Bank, offer these existing project banks as optional reference bases:\n${renderReferenceProjects(referenceProjectPaths)}`
      : "";

  return `No project Memory Bank exists for this repository yet. Before doing substantial project-specific work, ask the user a short direct question such as: "Create a project Memory Bank for this repository now, or skip it for now?"${referenceSection}

Internal next steps after the user answers:
- If the user wants to create it, call \`create_bank\`.
- If the user does not want to create it, record that choice with \`set_project_state\` using \`creationState: "declined"\`.
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
