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
export const PROJECT_DESCRIPTION = packageJson.description ?? "Bootstrap CLI and local runtime for Memory Bank.";
export const MCP_SERVER_INSTRUCTIONS =
  "Memory Bank MCP server. Start each new repository session by calling resolve_context with the current working directory and active provider. Use the returned rules and skills as the user-level Memory Bank baseline, then call resolve_context again if the working directory or task changes materially. Additional tools: bank_manifest, list_entries, and read_entry for local Memory Bank inspection.";
