import { DETECTABLE_STACKS, type DetectableStack } from "../context/types.js";
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
  if (detectedStacks.length === 1 && detectedStacks[0] === "other") {
    return `## Detected Stack

No specific stack signals were detected confidently. Use \`other\` as the conservative fallback stack and infer only project-supported patterns from the codebase.`;
  }

  return `## Detected Stack

Detected stack signals for this project:
${detectedStacks.map((stack) => `- ${stack}`).join("\n")}

Use these signals as a starting point, but verify them against the codebase before generating project-specific Memory Bank entries.`;
};

const renderSupportedStackIdsSection = (): string => `## Supported Stack Ids

Use only these canonical stack ids in Memory Bank stack metadata and create-flow reasoning:
${DETECTABLE_STACKS.map((stack) => `- ${stack}`).join("\n")}

If no specific stack fits confidently, use \`other\` instead of inventing a new stack id.`;

const renderReferenceProjectsSection = (selectedReferenceProjects: readonly ReferenceProjectCandidate[]): string => {
  if (selectedReferenceProjects.length === 0) {
    return "No reference project banks were selected. Create the project bank from the real codebase and the shared Memory Bank context.";
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

This create flow is iterative. Use this first step to orient yourself, inspect the project, and prepare the canonical bank plan before continuing through the later review, import, derive, and finalize steps.

Project path:
- \`${projectPath}\`

Target Memory Bank path:
- \`${projectBankPath}\`

Target directories:
- Rules: \`${rulesDirectory}\`
- Skills: \`${skillsDirectory}\`

${renderStackSection(detectedStacks)}

${renderSupportedStackIdsSection()}

## Reference Projects

${renderReferenceProjectsSection(selectedReferenceProjects)}

## Goal

Create a project-specific Memory Bank that captures stable patterns from this repository without duplicating broad user-level guidance that already belongs in the shared Memory Bank layer.

## Source Hierarchy

Use these inputs together:
- Real project code and configuration from the repository
- Existing shared Memory Bank rules and skills already returned by \`resolve_context\`
- Any selected reference project banks listed above
- Any additional user instructions from the current chat

Important:
- Memory Bank is the canonical user-managed context for this project
- Provider-native guidance such as \`AGENTS.md\`, \`.cursor\`, \`.claude\`, or \`.codex\` is a separate repository-local layer
- Do not duplicate or mirror provider-native guidance into the Memory Bank blindly
- Repository-local guidance may be reviewed explicitly in later \`create_bank\` iterations, but it must not appear in normal runtime context returned by \`resolve_context\`
- During the iterative create/improve flow, write canonical Memory Bank changes through \`create_bank\` using its \`apply\` payload for batched writes and deletions
- Reserve the standalone MCP mutation tools for targeted updates outside the full create/improve flow
- When you need the full text of an existing Memory Bank entry, inspect it through \`list_entries\` and \`read_entry\` instead of inferring content from file names alone

## Canonical Output Contract

Write Memory Bank entries through MCP tools instead of editing the user storage directly.

During this iterative flow:
- prefer batched writes and deletions via \`create_bank.apply\`
- pass complete final documents, not partial markdown patches
- use \`baseSha256\` when replacing or deleting an entry you previously read from Memory Bank
- if \`create_bank.apply\` reports \`conflict\` for an entry, do not guess or overwrite blindly
- on conflict, re-read the affected entry through \`read_entry\`, rebuild the full final document, and retry the batch with the fresh \`baseSha256\`

Outside the iterative flow, the standalone tools are still available for targeted edits:
- \`upsert_rule\` for thematic rule files
- \`upsert_skill\` for skill folders with a single \`SKILL.md\`
- \`delete_entry\` for cleanup when you intentionally remove a previous entry

Rules:
- Rules live under \`${rulesDirectory}\`
- Rules are grouped by topic or stack in folders
- Each rule file contains a set of related rules united by one theme
- Each rule file must start with canonical frontmatter including at least \`id\`, \`kind: rule\`, and \`title\`
- Keep rule files short, focused, and evidence-based

Skills:
- Skills live under \`${skillsDirectory}\`
- Each skill has its own folder
- Each skill folder contains exactly one \`SKILL.md\`
- Each skill file must start with canonical frontmatter including at least \`id\`, \`kind: skill\`, \`title\`, and \`description\`
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

## Rule and Skill Quality Contract

Before writing or updating entries:
- Prefer project evidence over assumptions
- Generate project-specific rules, not generic philosophy
- Do not duplicate what formatter or linter configuration already enforces fully
- Keep one clear formulation per rule after deduplication

Create or keep a rule only when at least one is true:
- The pattern appears repeatedly in the codebase
- The pattern is encoded in configuration or tooling
- The pattern is documented and reflected in project structure
- The pattern is clearly part of the intended architecture

For each candidate rule, decide explicitly:
- keep: clear evidence and practical value
- skip: weak evidence or low value
- \`[VERIFY: ...]\`: partial evidence and the decision can affect workflow

Generate a skill only when it is a reusable multi-step workflow with clear project evidence.

Each skill should include:
- When to use
- Prerequisites
- Step-by-step workflow with real project paths
- Do not / anti-patterns when relevant

## Expected Bank Density

Aim for a right-sized bank, not a minimal placeholder:
- 2-6 focused rule files when project evidence supports them
- 2-5 focused skills when reusable workflows are clearly present
- for small or low-confidence projects, prefer fewer high-value entries over quota-filling

High-value starting points when evidence supports them:
- \`${rulesDirectory}/core/general.md\`
- \`${rulesDirectory}/topics/architecture.md\`
- one stack- or workflow-specific topic file
- \`${skillsDirectory}/adding-feature/SKILL.md\`
- \`${skillsDirectory}/adding-service/SKILL.md\`
- \`${skillsDirectory}/code-review/SKILL.md\`
- \`${skillsDirectory}/task-based-reading/SKILL.md\` or a troubleshooting skill

## This Step

During this initial step:
- Inspect the repository and selected reference projects
- Form a working plan for which canonical entries are likely needed first
- Avoid importing or deleting repository-local guidance yet; that review happens in later iterations
- Start writing canonical entries only when the evidence is already strong from the codebase, shared Memory Bank context, or selected reference projects

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

## Step Output

After completing this initial step, keep your output concise:
- one line per created or updated file
- short purpose for each file or planned file
- note any major uncertainties or skipped areas that should be handled in later iterations
`;
