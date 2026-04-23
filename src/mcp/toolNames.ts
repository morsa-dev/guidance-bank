export const MCP_TOOL_NAMES = {
  resolveContext: "resolve_context",
  upgradeBank: "upgrade_bank",
  syncBank: "sync_bank",
  createBank: "create_bank",
  improveBank: "improve_bank",
  clearProjectBank: "clear_project_bank",
  upsertRule: "upsert_rule",
  upsertSkill: "upsert_skill",
  deleteEntry: "delete_entry",
  setProjectState: "set_project_state",
  bankManifest: "bank_manifest",
  listEntries: "list_entries",
  readEntry: "read_entry",
} as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];

export const PUBLIC_MCP_TOOL_NAMES = [
  MCP_TOOL_NAMES.resolveContext,
  MCP_TOOL_NAMES.upgradeBank,
  MCP_TOOL_NAMES.syncBank,
  MCP_TOOL_NAMES.createBank,
  MCP_TOOL_NAMES.improveBank,
  MCP_TOOL_NAMES.clearProjectBank,
  MCP_TOOL_NAMES.upsertRule,
  MCP_TOOL_NAMES.upsertSkill,
  MCP_TOOL_NAMES.deleteEntry,
  MCP_TOOL_NAMES.setProjectState,
  MCP_TOOL_NAMES.bankManifest,
  MCP_TOOL_NAMES.listEntries,
  MCP_TOOL_NAMES.readEntry,
] as const satisfies readonly McpToolName[];
