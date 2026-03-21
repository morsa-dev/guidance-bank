import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { BankRepository } from "../storage/bankRepository.js";
import { registerBankManifestTool } from "./tools/registerBankManifestTool.js";
import { registerCreateBankTool } from "./tools/registerCreateBankTool.js";
import { registerDeleteEntryTool } from "./tools/registerDeleteEntryTool.js";
import { registerListEntriesTool } from "./tools/registerListEntriesTool.js";
import { registerReadEntryTool } from "./tools/registerReadEntryTool.js";
import { registerResolveContextTool } from "./tools/registerResolveContextTool.js";
import { registerSetProjectStateTool } from "./tools/registerSetProjectStateTool.js";
import { registerSyncBankTool } from "./tools/registerSyncBankTool.js";
import { registerUpsertRuleTool } from "./tools/registerUpsertRuleTool.js";
import { registerUpsertSkillTool } from "./tools/registerUpsertSkillTool.js";

export type McpServerRuntimeOptions = {
  repository: BankRepository;
};

export type ToolRegistrar = (server: McpServer, options: McpServerRuntimeOptions) => void;

const toolRegistrars: ToolRegistrar[] = [
  registerResolveContextTool,
  registerSyncBankTool,
  registerCreateBankTool,
  registerUpsertRuleTool,
  registerUpsertSkillTool,
  registerDeleteEntryTool,
  registerSetProjectStateTool,
  registerBankManifestTool,
  registerListEntriesTool,
  registerReadEntryTool,
];

export const registerTools = (server: McpServer, options: McpServerRuntimeOptions): void => {
  for (const registerTool of toolRegistrars) {
    registerTool(server, options);
  }
};
