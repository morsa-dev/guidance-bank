import { createRequire } from "node:module";

type PackageJson = {
  name: string;
  version: string;
  description?: string;
};

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as PackageJson;

export const PROJECT_NAME = packageJson.name;
export const PROJECT_VERSION = packageJson.version;
export const PROJECT_DESCRIPTION =
  packageJson.description ?? "Persistent rules, skills, and reusable guidance for coding agents.";
export const MCP_SERVER_INSTRUCTIONS =
  "For any repository-scoped work, resolve_context is the mandatory first call before editing files, or running normal project analysis. Call resolve_context with the absolute project path and use the returned context as the primary guidance layer that is currently available. Use create_bank explicitly when the user wants to create, continue, improve, or reconcile project-bank state. AI Guidance Bank is the primary user-managed guidance layer for durable rules, skills, and project-specific guidance outside the repository. It coexists with provider-native repository guidance without duplicating it during normal runtime.";
