import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { InitService } from "../src/core/init/initService.js";
import { createMcpServer } from "../src/mcp/createMcpServer.js";
import type { CommandRunner } from "../src/core/providers/types.js";

const createSuccessfulCommandRunner = (): CommandRunner => async ({ command, args }) => ({
  command,
  args,
  exitCode: command === "codex" && args[1] === "get" ? 1 : command === "claude" && args[1] === "get" ? 1 : 0,
  stdout: "",
  stderr: "",
});

const createConnectedClient = async (bankRoot: string) => {
  const server = createMcpServer({ bankRoot });
  const client = new Client({
    name: "mb-cli-test-client",
    version: "0.0.0",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const close = async () => {
    await Promise.allSettled([client.close(), server.close()]);
  };

  return { client, close };
};

test("server registers public Memory Bank tools with output schemas", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const initService = new InitService();
  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const result = await client.listTools();
  const tools = new Map(result.tools.map((tool) => [tool.name, tool]));

  assert.deepEqual([...tools.keys()].sort(), ["bank_manifest", "list_entries", "read_entry"]);
  assert.ok(tools.get("bank_manifest")?.outputSchema);
  assert.ok(tools.get("list_entries")?.outputSchema);
  assert.ok(tools.get("read_entry")?.outputSchema);
});

test("bank_manifest returns validated structured content", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const initService = new InitService();
  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["claude-code"],
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "bank_manifest",
      arguments: {},
    }),
  );

  const structuredContent = z
    .object({
      enabledProviders: z.array(z.string()),
      defaultMcpTransport: z.literal("stdio"),
    })
    .parse(result.structuredContent);

  assert.equal(result.isError, undefined);
  assert.deepEqual(structuredContent.enabledProviders, ["claude-code"]);
});

test("read_entry surfaces invalid arguments as tool errors", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const initService = new InitService();
  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "read_entry",
      arguments: {
        kind: "rules",
        path: "",
      },
    }),
  );

  const firstBlock = result.content[0];
  const firstText = firstBlock?.type === "text" ? firstBlock.text : "";

  assert.equal(result.isError, true);
  assert.match(firstText, /Invalid arguments for tool read_entry/);
});
