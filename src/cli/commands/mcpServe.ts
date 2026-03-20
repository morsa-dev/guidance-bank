import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "../../mcp/createMcpServer.js";

export const runMcpServeCommand = async (): Promise<void> => {
  const bankRoot = process.env.MB_BANK_ROOT;
  const server = createMcpServer(bankRoot ? { bankRoot } : {});
  const transport = new StdioServerTransport();

  await server.connect(transport);
};
