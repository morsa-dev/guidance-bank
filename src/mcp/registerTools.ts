import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ProviderId } from "../core/bank/types.js";
import type { BankRepository } from "../storage/bankRepository.js";
import type { AuditLogger } from "../storage/auditLogger.js";
import { registerBankManifestTool } from "./tools/registerBankManifestTool.js";
import { registerClearProjectBankTool } from "./tools/registerClearProjectBankTool.js";
import { registerCreateBankTool } from "./tools/create-bank/register.js";
import { registerDeleteEntryTool } from "./tools/registerDeleteEntryTool.js";
import { registerListEntriesTool } from "./tools/registerListEntriesTool.js";
import { registerReadEntryTool } from "./tools/registerReadEntryTool.js";
import { registerResolveContextTool } from "./tools/registerResolveContextTool.js";
import { registerSetProjectStateTool } from "./tools/registerSetProjectStateTool.js";
import { registerSyncBankTool } from "./tools/registerSyncBankTool.js";
import { registerUpgradeBankTool } from "./tools/registerUpgradeBankTool.js";
import { registerUpsertRuleTool } from "./tools/registerUpsertRuleTool.js";
import { registerUpsertSkillTool } from "./tools/registerUpsertSkillTool.js";

export type McpServerRuntimeOptions = {
  repository: BankRepository;
  provider: ProviderId | null;
  auditLogger: AuditLogger;
};

export type ToolRegistrar = (server: McpServer, options: McpServerRuntimeOptions) => void;

const toolRegistrars: ToolRegistrar[] = [
  registerResolveContextTool,
  registerUpgradeBankTool,
  registerSyncBankTool,
  registerCreateBankTool,
  registerClearProjectBankTool,
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
