import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { BankRepository } from "../storage/bankRepository.js";
import { resolveBankRoot } from "../shared/paths.js";
import { MCP_SERVER_INSTRUCTIONS, PROJECT_NAME, PROJECT_VERSION } from "./serverMetadata.js";
import { type McpServerRuntimeOptions, registerTools } from "./registerTools.js";

export type CreateMcpServerOptions = {
  bankRoot?: string;
};

export const createMcpServer = (options: CreateMcpServerOptions = {}): McpServer => {
  const repository = new BankRepository(resolveBankRoot(options.bankRoot));
  const runtimeOptions: McpServerRuntimeOptions = {
    repository,
  };

  const server = new McpServer(
    {
      name: PROJECT_NAME,
      version: PROJECT_VERSION,
    },
    {
      capabilities: {
        logging: {},
      },
      instructions: MCP_SERVER_INSTRUCTIONS,
    },
  );

  registerTools(server, runtimeOptions);

  return server;
};
