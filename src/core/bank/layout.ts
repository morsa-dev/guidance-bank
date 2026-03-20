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
];
