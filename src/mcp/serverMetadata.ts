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
  "At the start of each new project session, call resolve_context with the absolute project path and follow its returned text exactly. AI Guidance Bank is the primary user-managed guidance layer for durable rules, skills, and project-specific guidance outside the repository. It coexists with provider-native repository guidance without duplicating it during normal runtime.";
