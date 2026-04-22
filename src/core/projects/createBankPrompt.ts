import { DETECTABLE_STACKS, type DetectableStack, type ReferenceProjectCandidate } from "../context/types.js";

type CreateBankPromptInput = {
  projectName: string;
  projectPath: string;
  projectBankPath: string;
  rulesDirectory: string;
  skillsDirectory: string;
  detectedStacks: DetectableStack[];
  selectedReferenceProjects: ReferenceProjectCandidate[];
};

const renderDetectedStackSection = (detectedStacks: readonly DetectableStack[]): string => {
  if (detectedStacks.length === 1 && detectedStacks[0] === "other") {
    return `## Detected Stack

No specific stack signals were detected confidently. Use \`other\` as the fallback stack and infer only project-supported patterns from the codebase.`;
  }

  return `## Detected Stack

${detectedStacks.map((stack) => `- ${stack}`).join("\n")}`;
};

const renderSupportedStackIdsSection = (): string => `## Entry Selector

Rules and skills must use exactly one explicit selector.

- Set \`stack\` to a single canonical id when the rule or skill is specific to one technology
- Set \`alwaysOn: true\` only for guidance that must be included for every repository
- Never omit both \`stack\` and \`alwaysOn\`, and never use both in the same entry
- If guidance would apply to two or more distinct stacks, create a separate file for each stack rather than combining them in one entry
- Use only these canonical stack ids:
${DETECTABLE_STACKS.map((stack) => `  - ${stack}`).join("\n")}

If no specific stack fits confidently, use \`other\` only when the entry is still stack-scoped to an unsupported or generic stack. Use \`alwaysOn: true\` only when the guidance is intentionally global.`;

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

export const buildCreateBankPrompt = ({
  projectName,
  projectPath,
  projectBankPath,
  rulesDirectory,
  skillsDirectory,
  detectedStacks,
  selectedReferenceProjects,
}: CreateBankPromptInput): string => `# Project AI Guidance Bank Creation

You are creating the canonical AI Guidance Bank for \`${projectName}\`.

Project path:
- \`${projectPath}\`

Target AI Guidance Bank:
- \`${projectBankPath}\`
- Rules root: \`${rulesDirectory}\`
- Skills root: \`${skillsDirectory}\`

${renderDetectedStackSection(detectedStacks)}

${renderSupportedStackIdsSection()}

${renderReferenceProjectsSection(selectedReferenceProjects)}

## Stable Contract

- AI Guidance Bank is the canonical user-managed guidance layer for this project
- AI Guidance Bank stores durable rules, skills, and reusable project guidance across sessions
- Use \`phase\` as the primary guide during the create/improve flow; treat \`iteration\` as diagnostic only
- Use real project code, shared AI Guidance Bank context, selected reference projects, and explicit user instructions as the main inputs
- External repository-local, provider-project, and provider-global guidance must be reviewed explicitly in later steps before import
- Provider-local skills, provider-global skills, and model-native instructions may help analysis, but they never count as canonical AI Guidance Bank coverage until useful guidance is imported into shared/project AI Guidance Bank entries

## Writing Contract

- During the guided flow, prefer batched writes through \`create_bank.apply\`
- Pass complete final documents, not partial markdown patches
- \`create_bank.apply.path\` must be relative to the rules/skills root:
  - rules: \`general.md\`, \`architecture.md\`
  - skills: \`adding-feature\`, \`task-based-reading\`
- Do not prefix apply paths with \`rules/\` or \`skills/\`
- When replacing or deleting an existing entry, read it first and pass \`baseSha256\`
- If \`create_bank.apply\` reports a conflict, re-read the affected entry and retry with a fresh \`baseSha256\`
- Reserve \`upsert_rule\`, \`upsert_skill\`, and \`delete_entry\` for targeted edits outside the full create/improve flow

## Scope Rules

- Put guidance in the project bank only when it reflects stable patterns from this repository or meaningfully refines shared guidance
- Put clearly reusable cross-project guidance into the shared layer instead of the project layer
- Only shared/project AI Guidance Bank entries and explicitly reviewed external sources count as canonical coverage

## Kickoff Expectations

During the initial step:
- inspect the repository and selected reference projects
- build a broad candidate inventory before the first major write batch
- consider rules and skills together while building the initial candidate inventory
- for non-trivial projects with clear architectural patterns, plan for 5+ rules and 3+ skills — scale down only when the project evidence genuinely does not support it
- do not import or delete external guidance yet; that happens in later review/import steps
- do not stop after the first acceptable batch if the project clearly supports stronger canonical coverage
`;
