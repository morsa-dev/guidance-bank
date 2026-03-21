import type { DetectableStack, ReferenceProjectCandidate } from "../context/types.js";

import { buildCreateBankPrompt } from "./createBankPrompt.js";
import type { ExistingGuidanceSource } from "./discoverExistingGuidance.js";
import type { ProjectEvidenceInventory } from "./discoverProjectEvidence.js";
import type { RecentProjectCommit } from "./discoverRecentCommits.js";

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
  projectEvidence: ProjectEvidenceInventory;
  recentCommits: RecentProjectCommit[];
};

const appendContinuationInstruction = (prompt: string, iteration: number): string => `${prompt}

## Continuation

After completing this step, call \`create_bank\` again with \`iteration: ${iteration + 1}\`.`;

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

const renderProjectEvidenceSection = (projectEvidence: ProjectEvidenceInventory): string => {
  const directoryLines =
    projectEvidence.topLevelDirectories.length > 0
      ? projectEvidence.topLevelDirectories.map((directoryName) => `- ${directoryName}`).join("\n")
      : "- No common top-level project directories were auto-detected.";
  const fileLines =
    projectEvidence.evidenceFiles.length > 0
      ? projectEvidence.evidenceFiles.map((file) => `- [${file.kind}] ${file.relativePath}`).join("\n")
      : "- No project evidence files were auto-detected.";

  return `## Project Evidence

Top-level directories:
${directoryLines}

Evidence files:
${fileLines}`;
};

const renderRecentCommitsSection = (recentCommits: readonly RecentProjectCommit[]): string => {
  if (recentCommits.length === 0) {
    return `## Recent Commits

No recent git commits were discovered automatically for this project.`;
  }

  return `## Recent Commits

${recentCommits.map((commit) => `- ${commit.shortHash} ${commit.subject}`).join("\n")}`;
};

const buildReviewExistingPrompt = (projectPath: string, discoveredSources: readonly ExistingGuidanceSource[]): string => `# Existing Guidance Review

Review any existing repository-local guidance before importing it into Memory Bank.

Project path:
- \`${projectPath}\`

${renderDiscoveredSourcesSection(discoveredSources)}

What to do:
- Read the discovered guidance sources and identify what is still useful, redundant, project-specific, or reusable across projects
- Ask the user what to do with each meaningful source:
  - ignore it and keep the source as-is
  - copy it into Memory Bank
  - move it into Memory Bank and then delete the original source only after explicit confirmation
- Do not duplicate provider-native guidance blindly into Memory Bank
- Keep a concise record in chat of what was reviewed and what needs user confirmation`;

const buildImportSelectedPrompt = (discoveredSources: readonly ExistingGuidanceSource[]): string => `# Import Selected Guidance

Import only the guidance the user approved for canonicalization.

${renderDiscoveredSourcesSection(discoveredSources)}

What to do:
- Convert approved guidance into canonical Memory Bank rules and skills
- Split entries between project scope and shared scope when appropriate
- Assign stable ids, titles, topics, and stacks
- Deduplicate against existing Memory Bank content before writing
- If the user approved a move instead of a copy, delete the original source only after the canonical entry is written and the deletion is explicitly confirmed`;

const buildDeriveFromProjectPrompt = (projectPath: string, projectEvidence: ProjectEvidenceInventory): string => `# Derive From Project

Derive additional Memory Bank entries from the real repository.

Project path:
- \`${projectPath}\`

${renderProjectEvidenceSection(projectEvidence)}

What to do:
- Inspect project structure, configuration, source files, and recurring implementation patterns
- Create a focused set of high-value project rules and skills
- Prefer stable patterns over one-off details
- Put reusable cross-project guidance into shared scope only when the evidence is strong`;

const buildDeriveFromDocsAndCommitsPrompt = (
  projectEvidence: ProjectEvidenceInventory,
  recentCommits: readonly RecentProjectCommit[],
): string => `# Derive From Docs And Commits

Use repository documentation and recent change history as additional evidence.

${renderProjectEvidenceSection({
  ...projectEvidence,
  topLevelDirectories: [],
})}

${renderRecentCommitsSection(recentCommits)}

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
  discoveredSources,
  projectEvidence,
  recentCommits,
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
    return appendContinuationInstruction(buildReviewExistingPrompt(projectPath, discoveredSources), 1);
  }

  if (iteration === 2) {
    return appendContinuationInstruction(buildImportSelectedPrompt(discoveredSources), 2);
  }

  if (iteration === 3) {
    return appendContinuationInstruction(buildDeriveFromProjectPrompt(projectPath, projectEvidence), 3);
  }

  if (iteration === 4) {
    return appendContinuationInstruction(buildDeriveFromDocsAndCommitsPrompt(projectEvidence, recentCommits), 4);
  }

  return buildFinalizePrompt();
};
