import type { DetectableStack, ReferenceProjectCandidate } from "../context/types.js";

import { buildCreateBankPrompt } from "./createBankPrompt.js";

type BuildCreateBankIterationPromptInput = {
  iteration: number;
  projectName: string;
  projectPath: string;
  projectBankPath: string;
  rulesDirectory: string;
  skillsDirectory: string;
  detectedStacks: DetectableStack[];
  selectedReferenceProjects: ReferenceProjectCandidate[];
};

const appendContinuationInstruction = (prompt: string, iteration: number): string => `${prompt}

## Continuation

After completing this step, call \`create_bank\` again with \`iteration: ${iteration + 1}\`.`;

const buildReviewExistingPrompt = (projectPath: string): string => `# Existing Guidance Review

Review any existing repository-local guidance before importing it into Memory Bank.

Project path:
- \`${projectPath}\`

What to do:
- Find repository-local guidance files and folders such as \`AGENTS.md\`, \`CLAUDE.md\`, \`claude.md\`, \`.cursor/\`, \`.claude/\`, and \`.codex/\`
- Read them and identify what is still useful, redundant, project-specific, or reusable across projects
- Ask the user what to do with each meaningful source:
  - ignore it and keep the source as-is
  - copy it into Memory Bank
  - move it into Memory Bank and then delete the original source only after explicit confirmation
- Do not duplicate provider-native guidance blindly into Memory Bank
- Keep a concise record in chat of what was reviewed and what needs user confirmation`;

const buildImportSelectedPrompt = (): string => `# Import Selected Guidance

Import only the guidance the user approved for canonicalization.

What to do:
- Convert approved guidance into canonical Memory Bank rules and skills
- Split entries between project scope and shared scope when appropriate
- Assign stable ids, titles, topics, and stacks
- Deduplicate against existing Memory Bank content before writing
- If the user approved a move instead of a copy, delete the original source only after the canonical entry is written and the deletion is explicitly confirmed`;

const buildDeriveFromProjectPrompt = (projectPath: string): string => `# Derive From Project

Derive additional Memory Bank entries from the real repository.

Project path:
- \`${projectPath}\`

What to do:
- Inspect project structure, configuration, source files, and recurring implementation patterns
- Create a focused set of high-value project rules and skills
- Prefer stable patterns over one-off details
- Put reusable cross-project guidance into shared scope only when the evidence is strong`;

const buildDeriveFromDocsAndCommitsPrompt = (): string => `# Derive From Docs And Commits

Use repository documentation and recent change history as additional evidence.

What to do:
- Review README and any relevant docs folders or docs files
- Review the latest 5 commits for repeated corrections, constraints, or workflow expectations
- Convert only stable, evidence-backed patterns into canonical Memory Bank entries
- Skip noisy or temporary details`;

const buildFinalizePrompt = (): string => `# Finalize Memory Bank

Finish the project Memory Bank creation flow.

What to do:
- Deduplicate overlapping rules and skills
- Verify scope split between shared and project entries
- Check ids, titles, topics, and stacks for consistency
- If confidence is low for any high-impact rule, ask the user before keeping it
- Return a concise completion report when the bank is in a good canonical state`;

export const buildCreateBankIterationPrompt = ({
  iteration,
  projectName,
  projectPath,
  projectBankPath,
  rulesDirectory,
  skillsDirectory,
  detectedStacks,
  selectedReferenceProjects,
}: BuildCreateBankIterationPromptInput): string => {
  if (iteration <= 0) {
    return appendContinuationInstruction(
      buildCreateBankPrompt({
        projectName,
        projectPath,
        projectBankPath,
        rulesDirectory,
        skillsDirectory,
        detectedStacks,
        selectedReferenceProjects,
      }),
      0,
    );
  }

  if (iteration === 1) {
    return appendContinuationInstruction(buildReviewExistingPrompt(projectPath), 1);
  }

  if (iteration === 2) {
    return appendContinuationInstruction(buildImportSelectedPrompt(), 2);
  }

  if (iteration === 3) {
    return appendContinuationInstruction(buildDeriveFromProjectPrompt(projectPath), 3);
  }

  if (iteration === 4) {
    return appendContinuationInstruction(buildDeriveFromDocsAndCommitsPrompt(), 4);
  }

  return buildFinalizePrompt();
};
