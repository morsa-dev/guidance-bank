import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { BankRepository } from "../storage/bankRepository.js";
import { registerBankManifestTool } from "./tools/registerBankManifestTool.js";
import { registerListEntriesTool } from "./tools/registerListEntriesTool.js";
import { registerReadEntryTool } from "./tools/registerReadEntryTool.js";
import { registerResolveContextTool } from "./tools/registerResolveContextTool.js";

export type McpServerRuntimeOptions = {
  repository: BankRepository;
};

export type ToolRegistrar = (server: McpServer, options: McpServerRuntimeOptions) => void;

const toolRegistrars: ToolRegistrar[] = [
  registerResolveContextTool,
  registerBankManifestTool,
  registerListEntriesTool,
  registerReadEntryTool,
];

export const registerTools = (server: McpServer, options: McpServerRuntimeOptions): void => {
  for (const registerTool of toolRegistrars) {
    registerTool(server, options);
  }
};
