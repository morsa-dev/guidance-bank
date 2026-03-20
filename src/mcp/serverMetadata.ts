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
  "Memory Bank MCP server. Memory Bank is the primary user-managed context layer for agent rules and skills without writing them into the repository. Start each new repository session by calling resolve_context with the absolute project path. If the returned status is ready, use the resolved Memory Bank rules and skills as the primary context. If the status is missing, ask the user whether to create a project Memory Bank; if they agree, call create_bank and then populate it through upsert_rule and upsert_skill, and if they decline, persist that decision with set_project_state. Use delete_entry only when the user wants an entry removed. Prefer the project layer for repository-specific guidance and the shared layer for reusable cross-project or stack guidance; if the correct scope is ambiguous, ask the user explicitly. If local AGENTS.md, .cursor, .claude, or .codex files already exist, treat them as repository-local reference or migration input, not as the canonical Memory Bank source. If the status is creation_declined, do not ask again unless the user explicitly requests Memory Bank creation. Additional tools: bank_manifest, list_entries, and read_entry for local Memory Bank inspection.";
