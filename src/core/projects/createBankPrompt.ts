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

const renderSupportedStackIdsSection = (): string => `## Supported Stack Ids

Use only these canonical stack ids in AI Guidance Bank metadata:
${DETECTABLE_STACKS.map((stack) => `- ${stack}`).join("\n")}

If no specific stack fits confidently, use \`other\`.`;

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
- External repository-local or provider-project guidance must be reviewed explicitly in later steps before import
- Provider-local skills, provider-global skills, and model-native instructions may help analysis, but they never count as canonical AI Guidance Bank coverage

## Writing Contract

- During the guided flow, prefer batched writes through \`create_bank.apply\`
- Pass complete final documents, not partial markdown patches
- \`create_bank.apply.path\` must be relative to the rules/skills root:
  - rules: \`core/general.md\`, \`topics/architecture.md\`
  - skills: \`adding-feature\`, \`task-based-reading\`
- Do not prefix apply paths with \`rules/\` or \`skills/\`
- When replacing or deleting an existing entry, read it first and pass \`baseSha256\`
- If \`create_bank.apply\` reports a conflict, re-read the affected entry and retry with a fresh \`baseSha256\`
- Reserve \`upsert_rule\`, \`upsert_skill\`, and \`delete_entry\` for targeted edits outside the full create/improve flow

## Scope Rules

- Put guidance in the project bank only when it reflects stable patterns from this repository or meaningfully refines shared guidance
- Put clearly reusable cross-project guidance into the shared layer instead of the project layer
- Only shared/project AI Guidance Bank entries and explicitly reviewed external sources count as canonical coverage

## Coverage Expectations

- Create a right-sized bank, not a thin summary
- Consider both rules and skills
- Build a candidate list before the first substantial write batch
- If obvious candidates are skipped, keep a clear reason and reflect it later in \`stepOutcomeNote\`

Expected Bank Density:
- 2-6 focused rule files when project evidence supports them
- 2-5 focused skills when reusable workflows are clearly present

## Kickoff Expectations

During the initial step:
- inspect the repository and selected reference projects
- build a broad candidate inventory before the first major write batch
- do not import or delete external guidance yet; that happens in later review/import steps
- do not stop after the first acceptable batch if the project clearly supports stronger canonical coverage
`;
