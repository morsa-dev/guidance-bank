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
export const PROJECT_DESCRIPTION = packageJson.description ?? "Local Memory Bank runtime and MCP host for coding agents.";
export const MCP_SERVER_INSTRUCTIONS =
  "At the start of each new project session, call resolve_context with the absolute project path and follow its returned text exactly. Memory Bank is the primary user-managed context layer for agent rules and skills outside the repository, and it coexists with provider-native repository guidance without duplicating it during normal runtime.";
