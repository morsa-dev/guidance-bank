import type { DetectableStack } from "../context/types.js";
import type { ReferenceProjectCandidate } from "../context/types.js";

type CreateBankPromptInput = {
  projectName: string;
  projectPath: string;
  projectBankPath: string;
  rulesDirectory: string;
  skillsDirectory: string;
  detectedStacks: DetectableStack[];
  selectedReferenceProjects: ReferenceProjectCandidate[];
};

const renderStackSection = (detectedStacks: readonly DetectableStack[]): string => {
  if (detectedStacks.length === 0) {
    return `## Detected Stack

No stable stack signals were detected automatically. Infer the stack from the codebase before creating project-specific rules or skills.`;
  }

  return `## Detected Stack

Detected stack signals for this project:
${detectedStacks.map((stack) => `- ${stack}`).join("\n")}

Use these signals as a starting point, but verify them against the codebase before generating project-specific Memory Bank entries.`;
};

const renderReferenceProjectsSection = (selectedReferenceProjects: readonly ReferenceProjectCandidate[]): string => {
  if (selectedReferenceProjects.length === 0) {
    return "No reference project banks were selected. Create the project bank from the real codebase, shared Memory Bank context, and any local repository guidance.";
  }

  const projectLines = selectedReferenceProjects
    .map(
      (project) => `- ${project.projectName}
  - Project path: \`${project.projectPath}\`
  - Memory Bank path: \`${project.projectBankPath}\`
  - Shared stacks with the current project: ${project.sharedStacks.join(", ")}`,
    )
    .join("\n");

  return `Use these existing project Memory Banks as reference material while creating the new bank:

${projectLines}`;
};

export const buildCreateBankPrompt = ({
  projectName,
  projectPath,
  projectBankPath,
  rulesDirectory,
  skillsDirectory,
  detectedStacks,
  selectedReferenceProjects,
}: CreateBankPromptInput): string => `# Project Memory Bank Creation

You are creating a canonical Memory Bank for the project \`${projectName}\`.

Project path:
- \`${projectPath}\`

Target Memory Bank path:
- \`${projectBankPath}\`

Target directories:
- Rules: \`${rulesDirectory}\`
- Skills: \`${skillsDirectory}\`

${renderStackSection(detectedStacks)}

## Reference Projects

${renderReferenceProjectsSection(selectedReferenceProjects)}

## Goal

Create a project-specific Memory Bank that captures stable patterns from this repository without duplicating broad user-level guidance that already belongs in the shared Memory Bank layer.

## Source Hierarchy

Use these inputs together:
- Real project code and configuration from the repository
- Existing shared Memory Bank rules and skills already returned by \`resolve_context\`
- Any selected reference project banks listed above
- Any existing repo-local agent guidance such as \`AGENTS.md\`, \`.cursor\`, \`.claude\`, or \`.codex\` as migration/reference input
- Any additional user instructions from the current chat

Important:
- Memory Bank is the canonical user-managed context for this project
- Existing repo-local agent files are source material, not the final destination
- Extract durable patterns from them when useful, but write the canonical bank only into the target Memory Bank through the MCP mutation tools

## Canonical Output Contract

Write Memory Bank entries through MCP tools instead of editing the user storage directly.

Available write tools:
- \`upsert_rule\` for thematic rule files
- \`upsert_skill\` for skill folders with a single \`SKILL.md\`
- \`delete_entry\` for cleanup when you intentionally remove a previous entry

Rules:
- Rules live under \`${rulesDirectory}\`
- Rules are grouped by topic or stack in folders
- Each rule file contains a set of related rules united by one theme
- Keep rule files short, focused, and evidence-based

Skills:
- Skills live under \`${skillsDirectory}\`
- Each skill has its own folder
- Each skill folder contains exactly one \`SKILL.md\`
- Skills describe reusable workflows, not static constraints

## Project vs Shared Split

Before creating a project entry, decide whether it is truly project-specific.

Keep guidance in the project bank only when at least one is true:
- It reflects a stable pattern from this repository
- It depends on this repository's folder structure, routing, data flow, or tooling
- It meaningfully refines shared guidance with project-specific detail

Do not duplicate shared rules or skills unless the project needs a narrower override or a materially different workflow.

If you discover guidance that is clearly reusable across repositories or across a shared stack such as Angular, store it in the shared layer with \`scope: "shared"\` instead of the project layer.

If the right scope is unclear, ask the user explicitly whether the entry should live only in this project or in the shared layer.

## Quality Gates

- Explore the repository before writing
- Prefer a small number of high-value files over generic filler
- Deduplicate aggressively
- If evidence is weak, omit the entry or mark uncertainty explicitly
- Use real file paths from the repository in skill workflows
- Keep rules and skills clearly separated

## Suggested Initial File Shapes

Rules:
- \`${rulesDirectory}/core/general.md\`
- \`${rulesDirectory}/topics/architecture.md\`
- \`${rulesDirectory}/topics/routing.md\`
- \`${rulesDirectory}/stacks/<stack>/<topic>.md\`

Skills:
- \`${skillsDirectory}/adding-feature/SKILL.md\`
- \`${skillsDirectory}/adding-service/SKILL.md\`
- \`${skillsDirectory}/code-review/SKILL.md\`
- \`${skillsDirectory}/task-based-reading/SKILL.md\`

Create only the files justified by the project evidence.

## Final Output

After creating or updating the project Memory Bank files, return only a concise completion report:
- one line per created or updated file
- short purpose for each file
- note any major uncertainties or skipped areas
`;
