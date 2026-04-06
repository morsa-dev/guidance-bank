import assert from "node:assert/strict";
import test from "node:test";

import { createInitializedBank, createConnectedClient } from "./helpers/mcpTestUtils.js";

test("server registers public Memory Bank tools with output schemas", async (t) => {
  const { bankRoot } = await createInitializedBank();
  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const result = await client.listTools();
  const tools = new Map(result.tools.map((tool) => [tool.name, tool]));

  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      "bank_manifest",
      "clear_project_bank",
      "create_bank",
      "delete_entry",
      "delete_guidance_source",
      "improve_bank",
      "list_entries",
      "read_entry",
      "resolve_context",
      "set_project_state",
      "sync_bank",
      "upsert_rule",
      "upsert_skill",
    ],
  );

  for (const toolName of tools.keys()) {
    assert.ok(tools.get(toolName)?.outputSchema);
  }
});
