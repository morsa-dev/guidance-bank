import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ProviderId } from "../core/bank/types.js";
import { isProviderId } from "../core/providers/providerRegistry.js";
import { BankRepository } from "../storage/bankRepository.js";
import { AuditLogger } from "../storage/auditLogger.js";
import { resolveBankRoot } from "../shared/paths.js";
import { MCP_SERVER_INSTRUCTIONS, PROJECT_NAME, PROJECT_VERSION } from "./serverMetadata.js";
import { type McpServerRuntimeOptions, registerTools } from "./registerTools.js";

export type CreateMcpServerOptions = {
  bankRoot?: string;
  provider?: ProviderId | null;
};

export const createMcpServer = (options: CreateMcpServerOptions = {}): McpServer => {
  const repository = new BankRepository(resolveBankRoot(options.bankRoot));
  const providerFromEnv = process.env.GUIDANCEBANK_PROVIDER_ID;
  const provider =
    options.provider ?? (providerFromEnv && isProviderId(providerFromEnv) ? providerFromEnv : null);
  const runtimeOptions: McpServerRuntimeOptions = {
    repository,
    provider,
    auditLogger: new AuditLogger({
      bankRoot: repository.rootPath,
      provider,
    }),
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
