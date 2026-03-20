import path from "node:path";

import type { ProviderId } from "./types.js";

export type BankPaths = {
  root: string;
  manifestFile: string;
  rulesDirectory: string;
  skillsDirectory: string;
  mcpDirectory: string;
  integrationsDirectory: string;
  mcpServerConfigFile: string;
  integrationFile: (providerId: ProviderId) => string;
};

export const resolveBankPaths = (root: string): BankPaths => ({
  root,
  manifestFile: path.join(root, "manifest.json"),
  rulesDirectory: path.join(root, "rules"),
  skillsDirectory: path.join(root, "skills"),
  mcpDirectory: path.join(root, "mcp"),
  integrationsDirectory: path.join(root, "integrations"),
  mcpServerConfigFile: path.join(root, "mcp", "server.json"),
  integrationFile: (providerId) => path.join(root, "integrations", `${providerId}.json`),
});

export const createStarterFiles = (paths: BankPaths): Array<{ filePath: string; content: string }> => [
  {
    filePath: path.join(paths.rulesDirectory, "core", "README.md"),
    content: `# Core Rules

Store shared, provider-agnostic rules here.

- Use subdirectories to cluster rules by topic.
- Keep each rule as a separate markdown file.
`,
  },
  {
    filePath: path.join(paths.rulesDirectory, "core", "general.md"),
    content: `# General Behavior

- Apply these rules as user-level guidance across repositories unless the local project clearly conflicts.
- Keep changes tightly scoped and prefer existing project patterns over generic rewrites.
- Before non-trivial work, form a short plan and validate assumptions from the real codebase.
- Run the most relevant checks for touched areas, or state clearly why they could not be run.
`,
  },
  {
    filePath: path.join(paths.rulesDirectory, "stacks", "README.md"),
    content: `# Stack Rules

Store stack-specific rules here.

Examples:
- nodejs/
- typescript/
- react/
`,
  },
  {
    filePath: path.join(paths.rulesDirectory, "stacks", "nodejs", "runtime.md"),
    content: `# Node.js Runtime

- Respect the existing package manager and lockfile already present in the repository.
- Prefer stable CLI scripts from package.json over ad-hoc commands when available.
- Keep runtime and tooling changes backwards compatible unless the task explicitly requires a breaking change.
`,
  },
  {
    filePath: path.join(paths.rulesDirectory, "stacks", "typescript", "strict-mode.md"),
    content: `# TypeScript Strict Mode

- Preserve strict typing and avoid weakening types with \`any\`, broad casts, or unchecked fallbacks.
- Prefer narrowing and explicit domain types when changing shared interfaces or data contracts.
- Run a typecheck after TypeScript changes when the project has a supported typecheck command.
`,
  },
  {
    filePath: path.join(paths.rulesDirectory, "providers", "README.md"),
    content: `# Provider Rules

Store provider-specific rule variations here.

Examples:
- codex/
- cursor/
- claude-code/
`,
  },
  {
    filePath: path.join(paths.skillsDirectory, "README.md"),
    content: `# Skills

Store each skill in its own markdown file.

Examples:
- typescript-diagnostics.md
- angular-components.md
`,
  },
  {
    filePath: path.join(paths.skillsDirectory, "shared", "task-based-reading", "SKILL.md"),
    content: `---
name: task-based-reading
description: Use when starting work in an unfamiliar repository and you need to identify the minimum relevant files quickly.
---

# Task-Based Reading

## When to use
- Starting work in a new repository or feature area.
- The task is broad and you need to reduce file-reading noise.

## Workflow
1. Read the repository README and the nearest package/config files first.
2. Identify the feature entrypoint, then follow imports and route registration files.
3. Read only the minimum rules and skills relevant to the current task before editing.

## Do not
- Read the entire repository before narrowing scope.
- Infer architecture from one file when surrounding routing or config files are available.
`,
  },
];
