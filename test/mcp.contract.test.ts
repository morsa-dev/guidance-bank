import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      "bank_manifest",
      "create_bank",
      "delete_entry",
      "list_entries",
      "read_entry",
      "resolve_context",
      "set_project_state",
      "upsert_rule",
      "upsert_skill",
    ],
  );
  assert.ok(tools.get("bank_manifest")?.outputSchema);
  assert.ok(tools.get("create_bank")?.outputSchema);
  assert.ok(tools.get("delete_entry")?.outputSchema);
  assert.ok(tools.get("list_entries")?.outputSchema);
  assert.ok(tools.get("read_entry")?.outputSchema);
  assert.ok(tools.get("resolve_context")?.outputSchema);
  assert.ok(tools.get("set_project_state")?.outputSchema);
  assert.ok(tools.get("upsert_rule")?.outputSchema);
  assert.ok(tools.get("upsert_skill")?.outputSchema);
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

test("resolve_context returns shared context and missing status when no project bank exists", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const initService = new InitService();

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "demo-project",
        dependencies: {
          react: "^19.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(projectRoot, "tsconfig.json"), "{}\n");

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );

  const structuredContent = z
    .object({
      status: z.enum(["missing", "ready", "creation_declined"]),
      projectId: z.string(),
      projectName: z.string(),
      projectPath: z.string(),
      projectBankPath: z.string(),
      detectedStacks: z.array(z.string()),
      localGuidance: z.array(
        z.object({
          kind: z.string(),
          path: z.string(),
        }),
      ),
      rules: z.array(z.object({ path: z.string() })),
      skills: z.array(z.object({ path: z.string() })),
      agentInstructions: z.string(),
    })
    .parse(result.structuredContent);

  assert.equal(result.isError, undefined);
  assert.equal(structuredContent.status, "missing");
  assert.equal(structuredContent.projectName, "demo-project");
  assert.equal(structuredContent.projectPath, projectRoot);
  assert.deepEqual(structuredContent.detectedStacks, ["nodejs", "typescript", "react"]);
  assert.deepEqual(structuredContent.localGuidance, []);
  assert.deepEqual(
    structuredContent.rules.map((entry) => entry.path),
    ["core/general.md", "stacks/nodejs/runtime.md", "stacks/typescript/strict-mode.md"],
  );
  assert.deepEqual(structuredContent.skills.map((entry) => entry.path), ["shared/task-based-reading/SKILL.md"]);
  assert.match(structuredContent.agentInstructions, /primary user-managed context/i);
});

test("create_bank scaffolds a project bank and resolve_context returns ready status", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const initService = new InitService();

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "demo-project",
        dependencies: {
          react: "^19.0.0",
        },
      },
      null,
      2,
    ),
  );

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const createResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "create_bank",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );

  const createStructuredContent = z
    .object({
      status: z.enum(["created", "already_exists"]),
      projectId: z.string(),
      projectBankPath: z.string(),
      rulesDirectory: z.string(),
      skillsDirectory: z.string(),
      creationPrompt: z.string(),
    })
    .parse(createResult.structuredContent);

  assert.equal(createStructuredContent.status, "created");
  assert.match(createStructuredContent.creationPrompt, /Create a project-specific Memory Bank/i);

  const resolveResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );

  const resolveStructuredContent = z
    .object({
      status: z.enum(["missing", "ready", "creation_declined"]),
      projectBankPath: z.string(),
      localGuidance: z.array(
        z.object({
          kind: z.string(),
          path: z.string(),
        }),
      ),
      agentInstructions: z.string(),
    })
    .parse(resolveResult.structuredContent);

  assert.equal(resolveStructuredContent.status, "ready");
  assert.equal(resolveStructuredContent.projectBankPath, createStructuredContent.projectBankPath);
  assert.deepEqual(resolveStructuredContent.localGuidance, []);
  assert.match(resolveStructuredContent.agentInstructions, /primary user-managed context/i);
});

test("set_project_state persists declined creation and resolve_context stops asking again", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const initService = new InitService();

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo-project" }, null, 2));

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const setStateResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "set_project_state",
      arguments: {
        projectPath: projectRoot,
        creationState: "declined",
      },
    }),
  );

  const setStateStructuredContent = z
    .object({
      creationState: z.enum(["unknown", "declined", "ready"]),
    })
    .parse(setStateResult.structuredContent);

  assert.equal(setStateStructuredContent.creationState, "declined");

  const resolveResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );

  const resolveStructuredContent = z
    .object({
      status: z.enum(["missing", "ready", "creation_declined"]),
      localGuidance: z.array(
        z.object({
          kind: z.string(),
          path: z.string(),
        }),
      ),
      agentInstructions: z.string(),
    })
    .parse(resolveResult.structuredContent);

  assert.equal(resolveStructuredContent.status, "creation_declined");
  assert.deepEqual(resolveStructuredContent.localGuidance, []);
  assert.match(resolveStructuredContent.agentInstructions, /Do not ask to create a project Memory Bank again/i);
});

test("upsert tools can write shared and project entries, and delete_entry removes them", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const projectRoot = path.join(tempDirectoryPath, "angular-admin");
  const initService = new InitService();

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(projectRoot, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "angular-admin",
        dependencies: {
          "@angular/core": "^19.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(projectRoot, "tsconfig.json"), "{}\n");

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await client.callTool({
    name: "create_bank",
    arguments: {
      projectPath: projectRoot,
    },
  });

  const sharedRuleResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "upsert_rule",
      arguments: {
        scope: "shared",
        projectPath: projectRoot,
        path: "topics/angular-architecture.md",
        content: "# Angular Architecture\n\n- Keep route containers thin.\n",
      },
    }),
  );
  const sharedRuleStructured = z
    .object({
      status: z.enum(["created", "updated"]),
      scope: z.enum(["shared", "project"]),
      path: z.string(),
    })
    .parse(sharedRuleResult.structuredContent);
  assert.equal(sharedRuleStructured.status, "created");
  assert.equal(sharedRuleStructured.scope, "shared");
  assert.equal(sharedRuleStructured.path, "topics/angular-architecture.md");

  const projectRuleResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "upsert_rule",
      arguments: {
        scope: "project",
        projectPath: projectRoot,
        path: "topics/admin-dashboard.md",
        content: "# Admin Dashboard\n\n- Prefer existing feature containers over new top-level modules.\n",
      },
    }),
  );
  const projectRuleStructured = z
    .object({
      status: z.enum(["created", "updated"]),
      scope: z.enum(["shared", "project"]),
      path: z.string(),
    })
    .parse(projectRuleResult.structuredContent);
  assert.equal(projectRuleStructured.status, "created");
  assert.equal(projectRuleStructured.scope, "project");

  const sharedSkillResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "upsert_skill",
      arguments: {
        scope: "shared",
        projectPath: projectRoot,
        path: "stacks/angular/component-audit",
        content:
          "---\nname: component-audit\ndescription: Review Angular components before editing.\n---\n\n# Component Audit\n\n1. Check inputs and outputs.\n",
      },
    }),
  );
  const sharedSkillStructured = z
    .object({
      status: z.enum(["created", "updated"]),
      scope: z.enum(["shared", "project"]),
      path: z.string(),
      filePath: z.string(),
    })
    .parse(sharedSkillResult.structuredContent);
  assert.equal(sharedSkillStructured.status, "created");
  assert.equal(sharedSkillStructured.scope, "shared");
  assert.equal(sharedSkillStructured.filePath, "stacks/angular/component-audit/SKILL.md");

  const projectSkillResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "upsert_skill",
      arguments: {
        scope: "project",
        projectPath: projectRoot,
        path: "stacks/angular/adding-admin-widget",
        content:
          "---\nname: adding-admin-widget\ndescription: Add a new admin widget in this repository.\n---\n\n# Adding Admin Widget\n\n1. Start from the existing dashboard feature shell.\n",
      },
    }),
  );
  const projectSkillStructured = z
    .object({
      status: z.enum(["created", "updated"]),
      scope: z.enum(["shared", "project"]),
      path: z.string(),
      filePath: z.string(),
    })
    .parse(projectSkillResult.structuredContent);
  assert.equal(projectSkillStructured.status, "created");
  assert.equal(projectSkillStructured.scope, "project");

  const resolveAfterUpserts = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );
  const resolvedUpserts = z
    .object({
      rules: z.array(
        z.object({
          layer: z.enum(["shared", "project"]),
          path: z.string(),
        }),
      ),
      skills: z.array(
        z.object({
          layer: z.enum(["shared", "project"]),
          path: z.string(),
        }),
      ),
    })
    .parse(resolveAfterUpserts.structuredContent);

  assert.ok(
    resolvedUpserts.rules.some((entry) => entry.layer === "shared" && entry.path === "topics/angular-architecture.md"),
  );
  assert.ok(resolvedUpserts.rules.some((entry) => entry.layer === "project" && entry.path === "topics/admin-dashboard.md"));
  assert.ok(
    resolvedUpserts.skills.some((entry) => entry.layer === "shared" && entry.path === "stacks/angular/component-audit/SKILL.md"),
  );
  assert.ok(
    resolvedUpserts.skills.some(
      (entry) => entry.layer === "project" && entry.path === "stacks/angular/adding-admin-widget/SKILL.md",
    ),
  );

  const deleteProjectRuleResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "delete_entry",
      arguments: {
        scope: "project",
        kind: "rules",
        projectPath: projectRoot,
        path: "topics/admin-dashboard.md",
      },
    }),
  );
  const deleteProjectRuleStructured = z
    .object({
      status: z.enum(["deleted", "not_found"]),
      path: z.string(),
    })
    .parse(deleteProjectRuleResult.structuredContent);
  assert.equal(deleteProjectRuleStructured.status, "deleted");

  const deleteSharedSkillResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "delete_entry",
      arguments: {
        scope: "shared",
        kind: "skills",
        projectPath: projectRoot,
        path: "stacks/angular/component-audit",
      },
    }),
  );
  const deleteSharedSkillStructured = z
    .object({
      status: z.enum(["deleted", "not_found"]),
      path: z.string(),
    })
    .parse(deleteSharedSkillResult.structuredContent);
  assert.equal(deleteSharedSkillStructured.status, "deleted");

  const resolveAfterDeletes = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );
  const resolvedDeletes = z
    .object({
      rules: z.array(
        z.object({
          layer: z.enum(["shared", "project"]),
          path: z.string(),
        }),
      ),
      skills: z.array(
        z.object({
          layer: z.enum(["shared", "project"]),
          path: z.string(),
        }),
      ),
    })
    .parse(resolveAfterDeletes.structuredContent);

  assert.ok(!resolvedDeletes.rules.some((entry) => entry.path === "topics/admin-dashboard.md"));
  assert.ok(!resolvedDeletes.skills.some((entry) => entry.path === "stacks/angular/component-audit/SKILL.md"));
});
