import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_MCP_TOOL_NAMES } from "../src/mcp/toolNames.js";
import { createInitializedBank, createConnectedClient } from "./helpers/mcpTestUtils.js";

test("server registers public AI Guidance Bank tools with output schemas", async (t) => {
  const { bankRoot } = await createInitializedBank();
  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const result = await client.listTools();
  const tools = new Map(result.tools.map((tool) => [tool.name, tool]));

  assert.deepEqual(
    [...tools.keys()].sort(),
    [...PUBLIC_MCP_TOOL_NAMES].sort(),
  );

  for (const toolName of tools.keys()) {
    assert.ok(tools.get(toolName)?.outputSchema);
  }
});
