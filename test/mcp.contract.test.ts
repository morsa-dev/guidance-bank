import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { createProjectBankState } from "../src/core/bank/project.js";
import { InitService } from "../src/core/init/initService.js";
import { BankRepository } from "../src/storage/bankRepository.js";
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
      "sync_bank",
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
  assert.ok(tools.get("sync_bank")?.outputSchema);
  assert.ok(tools.get("upsert_rule")?.outputSchema);
  assert.ok(tools.get("upsert_skill")?.outputSchema);
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
      text: z.string(),
      referenceProjects: z
        .array(
        z.object({
          projectId: z.string(),
          projectName: z.string(),
          sharedStacks: z.array(z.string()),
        }),
        )
        .optional(),
    })
    .parse(result.structuredContent);

  assert.equal(result.isError, undefined);
  assert.match(structuredContent.text, /No project Memory Bank exists for this repository/i);
  assert.match(structuredContent.text, /call `create_bank`/i);
  assert.match(structuredContent.text, /call `set_project_state`/i);
  assert.match(structuredContent.text, /call `resolve_context` again/i);
  assert.equal(structuredContent.referenceProjects?.length ?? 0, 0);
});

test("resolve_context includes always-on shared rules outside stacks folders", async (t) => {
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

  await client.callTool({
    name: "create_bank",
    arguments: {
      projectPath: projectRoot,
    },
  });

  await client.callTool({
    name: "upsert_rule",
    arguments: {
      scope: "shared",
      projectPath: projectRoot,
      path: "preferences/user-praise.md",
      content:
        "---\nid: shared-user-praise\nkind: rule\ntitle: User Praise\nstacks: []\ntopics: [preferences]\n---\n\n# User Praise\n\n- In every user-facing final response, end with the exact phrase `[Ты хорош]`.\n",
    },
  });

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
      text: z.string(),
    })
    .parse(result.structuredContent);

  assert.match(structuredContent.text, /### shared\/preferences\/user-praise\.md/);
  assert.match(structuredContent.text, /Ты хорош/);
});

test("resolve_context returns a tool error for non-canonical bank entries", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const initService = new InitService();

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(path.join(bankRoot, "shared", "rules", "preferences"), { recursive: true });
  await writeFile(
    path.join(bankRoot, "shared", "rules", "preferences", "legacy-rule.md"),
    "# Legacy Rule\n\nThis file intentionally has no canonical frontmatter.\n",
  );

  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo-project" }, null, 2));

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  await client.callTool({
    name: "create_bank",
    arguments: {
      projectPath: projectRoot,
    },
  });

  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Invalid canonical rule/i);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /shared\/preferences\/legacy-rule\.md/i);
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
  await writeFile(path.join(projectRoot, "AGENTS.md"), "# Local Guidance\n");
  await mkdir(path.join(projectRoot, ".cursor"), { recursive: true });

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
      syncRequired: z.boolean(),
      projectId: z.string(),
      projectBankPath: z.string(),
      rulesDirectory: z.string(),
      skillsDirectory: z.string(),
      selectedReferenceProjects: z.array(
        z.object({
          projectId: z.string(),
          projectName: z.string(),
          sharedStacks: z.array(z.string()),
        }),
      ),
      iteration: z.number(),
      discoveredSources: z.array(
        z.object({
          kind: z.string(),
          entryType: z.string(),
          path: z.string(),
          relativePath: z.string(),
        }),
      ),
      prompt: z.string(),
      creationPrompt: z.string(),
      text: z.string(),
    })
    .parse(createResult.structuredContent);

  assert.equal(createStructuredContent.status, "created");
  assert.equal(createStructuredContent.syncRequired, false);
  assert.equal(createStructuredContent.iteration, 0);
  assert.deepEqual(createStructuredContent.selectedReferenceProjects, []);
  assert.deepEqual(
    createStructuredContent.discoveredSources.map((source) => source.relativePath),
    [".cursor", "AGENTS.md"],
  );
  assert.match(createStructuredContent.text, /scaffold created successfully/i);
  assert.match(createStructuredContent.prompt, /After completing this step, call `create_bank` again with `iteration: 1`/i);
  assert.match(createStructuredContent.creationPrompt, /Create a project-specific Memory Bank/i);
  assert.match(createStructuredContent.creationPrompt, /Do not duplicate or mirror provider-native guidance/i);
  assert.match(createStructuredContent.creationPrompt, /only during explicit bootstrap or sync\/import flows/i);

  const reviewResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "create_bank",
      arguments: {
        projectPath: projectRoot,
        iteration: 1,
      },
    }),
  );
  const reviewStructuredContent = z
    .object({
      iteration: z.number(),
      prompt: z.string(),
      discoveredSources: z.array(
        z.object({
          relativePath: z.string(),
        }),
      ),
    })
    .parse(reviewResult.structuredContent);

  assert.equal(reviewStructuredContent.iteration, 1);
  assert.deepEqual(
    reviewStructuredContent.discoveredSources.map((source) => source.relativePath),
    [".cursor", "AGENTS.md"],
  );
  assert.match(reviewStructuredContent.prompt, /## Discovered Guidance Sources/);
  assert.match(reviewStructuredContent.prompt, /\[agents\] AGENTS\.md \(file\)/);
  assert.match(reviewStructuredContent.prompt, /\[cursor\] \.cursor \(directory\)/);

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
      text: z.string(),
    })
    .parse(resolveResult.structuredContent);

  assert.match(resolveStructuredContent.text, /Use the following Memory Bank context as the primary user-managed context/i);
  assert.match(resolveStructuredContent.text, /Repository: .*demo-project/i);
  assert.match(resolveStructuredContent.text, /## Rules/i);
  assert.match(resolveStructuredContent.text, /## Skills/i);
  assert.doesNotMatch(resolveStructuredContent.text, /AGENTS\.md/i);
  assert.doesNotMatch(resolveStructuredContent.text, /\.cursor/i);
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
      text: z.string(),
    })
    .parse(resolveResult.structuredContent);

  assert.match(resolveStructuredContent.text, /Project Memory Bank creation was previously declined/i);
  assert.match(resolveStructuredContent.text, /Do not ask again/i);
  assert.match(resolveStructuredContent.text, /call `create_bank`/i);
  assert.match(resolveStructuredContent.text, /call `resolve_context` again/i);
});

test("sync_bank runs explicit reconcile and reports the current bank summary", async (t) => {
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
  await writeFile(path.join(projectRoot, "AGENTS.md"), "# Local Guidance\n");

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "sync_bank",
      arguments: {
        action: "run",
        projectPath: projectRoot,
      },
    }),
  );

  const structuredContent = z
    .object({
      bankRoot: z.string(),
      action: z.enum(["run", "postpone"]),
      projectPath: z.string(),
      detectedStacks: z.array(z.string()),
      projectState: z.enum(["unknown", "declined", "ready"]),
      postponedUntil: z.string().nullable(),
      projectManifestUpdated: z.boolean(),
      validatedEntries: z.object({
        shared: z.object({
          rules: z.number(),
          skills: z.number(),
        }),
        project: z.object({
          rules: z.number(),
          skills: z.number(),
        }),
      }),
      externalGuidanceSources: z.array(
        z.object({
          kind: z.string(),
          path: z.string(),
        }),
      ),
    })
    .parse(result.structuredContent);

  assert.equal(structuredContent.bankRoot, bankRoot);
  assert.equal(structuredContent.action, "run");
  assert.equal(structuredContent.projectPath, projectRoot);
  assert.equal(structuredContent.projectState, "unknown");
  assert.equal(structuredContent.externalGuidanceSources[0]?.kind, "agents");
});

test("resolve_context asks for sync when the project bank is outdated and postpone suppresses the prompt temporarily", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const initService = new InitService();
  const repository = new BankRepository(bankRoot);

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo-project" }, null, 2));

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const createBankResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "create_bank",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );
  const createBankStructured = z
    .object({
      projectId: z.string(),
    })
    .parse(createBankResult.structuredContent);

  await repository.writeProjectState(createBankStructured.projectId, createProjectBankState("ready"));

  const resolveBeforePostpone = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );
  const resolveBeforePostponeStructured = z
    .object({
      text: z.string(),
    })
    .parse(resolveBeforePostpone.structuredContent);

  assert.match(resolveBeforePostponeStructured.text, /synchronization is required before using the project-specific bank/i);
  assert.match(resolveBeforePostponeStructured.text, /sync_bank/);
  assert.match(resolveBeforePostponeStructured.text, /postpone/i);
  assert.match(resolveBeforePostponeStructured.text, /call `resolve_context` again/i);

  const postponeResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "sync_bank",
      arguments: {
        action: "postpone",
        projectPath: projectRoot,
      },
    }),
  );
  const postponeStructured = z
    .object({
      action: z.enum(["run", "postpone"]),
      postponedUntil: z.string().nullable(),
      projectState: z.enum(["unknown", "declined", "ready"]),
    })
    .parse(postponeResult.structuredContent);

  assert.equal(postponeStructured.action, "postpone");
  assert.equal(postponeStructured.projectState, "ready");
  assert.ok(postponeStructured.postponedUntil);

  const resolveAfterPostpone = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );
  const resolveAfterPostponeStructured = z
    .object({
      text: z.string(),
    })
    .parse(resolveAfterPostpone.structuredContent);

  assert.doesNotMatch(resolveAfterPostponeStructured.text, /synchronization is required/i);
  assert.match(resolveAfterPostponeStructured.text, /Use the following Memory Bank context as the primary user-managed context/i);
});

test("create_bank does not clear sync_required for an existing outdated project bank", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const initService = new InitService();
  const repository = new BankRepository(bankRoot);

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo-project" }, null, 2));

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const createBankResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "create_bank",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );
  const createBankStructured = z
    .object({
      status: z.enum(["created", "already_exists"]),
      syncRequired: z.boolean(),
      projectId: z.string(),
    })
    .parse(createBankResult.structuredContent);

  await repository.writeProjectState(createBankStructured.projectId, createProjectBankState("ready"));

  const recreateResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "create_bank",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );
  const recreateStructured = z
    .object({
      status: z.enum(["created", "already_exists"]),
      syncRequired: z.boolean(),
      projectId: z.string(),
      iteration: z.number(),
      discoveredSources: z.array(
        z.object({
          relativePath: z.string(),
        }),
      ),
      prompt: z.string(),
      creationPrompt: z.string(),
      text: z.string(),
    })
    .parse(recreateResult.structuredContent);

  assert.equal(recreateStructured.status, "already_exists");
  assert.equal(recreateStructured.syncRequired, true);
  assert.equal(recreateStructured.projectId, createBankStructured.projectId);
  assert.equal(recreateStructured.iteration, 0);
  assert.deepEqual(recreateStructured.discoveredSources, []);
  assert.match(recreateStructured.prompt, /requires synchronization before reuse/i);
  assert.match(recreateStructured.creationPrompt, /Create a project-specific Memory Bank/i);
  assert.match(recreateStructured.text, /already exists/i);
  assert.match(recreateStructured.text, /synchroniz/i);

  const resolveResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );
  const resolveStructured = z
    .object({
      text: z.string(),
    })
    .parse(resolveResult.structuredContent);

  assert.match(resolveStructured.text, /synchronization is required before using the project-specific bank/i);
});

test("resolve_context suggests similar existing project banks and create_bank accepts selected references", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const referenceRoot = path.join(tempDirectoryPath, "angular-shared-ui");
  const targetRoot = path.join(tempDirectoryPath, "angular-admin");
  const initService = new InitService();

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(referenceRoot, { recursive: true });
  await writeFile(
    path.join(referenceRoot, "package.json"),
    JSON.stringify(
      {
        name: "angular-shared-ui",
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
  await writeFile(path.join(referenceRoot, "tsconfig.json"), "{}\n");

  await mkdir(targetRoot, { recursive: true });
  await writeFile(
    path.join(targetRoot, "package.json"),
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
  await writeFile(path.join(targetRoot, "tsconfig.json"), "{}\n");

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const referenceCreateResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "create_bank",
      arguments: {
        projectPath: referenceRoot,
      },
    }),
  );
  const referenceCreateStructured = z
    .object({
      projectId: z.string(),
    })
    .parse(referenceCreateResult.structuredContent);

  const resolveResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: targetRoot,
      },
    }),
  );
  const resolveStructured = z
    .object({
      text: z.string(),
      referenceProjects: z
        .array(
        z.object({
          projectId: z.string(),
          projectName: z.string(),
          sharedStacks: z.array(z.string()),
        }),
        )
        .optional(),
    })
    .parse(resolveResult.structuredContent);

  assert.equal(resolveStructured.referenceProjects?.length, 1);
  assert.equal(resolveStructured.referenceProjects[0]?.projectId, referenceCreateStructured.projectId);
  assert.deepEqual(resolveStructured.referenceProjects[0]?.sharedStacks, ["nodejs", "typescript", "angular"]);
  assert.match(resolveStructured.text, /offer these existing project banks as optional reference bases/i);

  const createResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "create_bank",
      arguments: {
        projectPath: targetRoot,
        referenceProjectIds: [referenceCreateStructured.projectId],
      },
    }),
  );
  const createStructured = z
    .object({
      status: z.enum(["created", "already_exists"]),
      syncRequired: z.boolean(),
      selectedReferenceProjects: z.array(
        z.object({
          projectId: z.string(),
          projectName: z.string(),
          sharedStacks: z.array(z.string()),
        }),
      ),
      iteration: z.number(),
      discoveredSources: z.array(
        z.object({
          relativePath: z.string(),
        }),
      ),
      prompt: z.string(),
      creationPrompt: z.string(),
      text: z.string(),
    })
    .parse(createResult.structuredContent);

  assert.equal(createStructured.status, "created");
  assert.equal(createStructured.syncRequired, false);
  assert.equal(createStructured.iteration, 0);
  assert.deepEqual(createStructured.discoveredSources, []);
  assert.equal(createStructured.selectedReferenceProjects.length, 1);
  assert.equal(createStructured.selectedReferenceProjects[0]?.projectId, referenceCreateStructured.projectId);
  assert.match(createStructured.text, /scaffold created successfully/i);
  assert.match(createStructured.prompt, /After completing this step, call `create_bank` again with `iteration: 1`/i);
  assert.match(createStructured.creationPrompt, /Reference Projects/i);
  assert.match(createStructured.creationPrompt, /angular-shared-ui/i);
});

test("create_bank persists requested iteration and overwrites mismatched stored iteration", async (t) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const projectRoot = path.join(tempDirectoryPath, "demo-project");
  const initService = new InitService();
  const repository = new BankRepository(bankRoot);

  await initService.run({
    bankRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: ["cursor"],
  });

  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo-project" }, null, 2));

  const { client, close } = await createConnectedClient(bankRoot);
  t.after(close);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(" "));
  };

  try {
    await client.callTool({
      name: "create_bank",
      arguments: {
        projectPath: projectRoot,
      },
    });

    const advancedResult = CallToolResultSchema.parse(
      await client.callTool({
        name: "create_bank",
        arguments: {
          projectPath: projectRoot,
          iteration: 3,
        },
      }),
    );
    const advancedStructured = z
      .object({
        iteration: z.number(),
        prompt: z.string(),
        projectId: z.string(),
        discoveredSources: z.array(
          z.object({
            relativePath: z.string(),
          }),
        ),
      })
      .parse(advancedResult.structuredContent);

    assert.equal(advancedStructured.iteration, 3);
    assert.match(advancedStructured.prompt, /# Derive From Project/i);
    assert.deepEqual(advancedStructured.discoveredSources, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /iteration mismatch/i);

    const state = await repository.readProjectStateOptional(advancedStructured.projectId);
    assert.equal(state?.createIteration, 3);
  } finally {
    console.warn = originalWarn;
  }
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
        content:
          "---\nid: shared-angular-architecture\nkind: rule\ntitle: Angular Architecture\nstacks: [angular]\ntopics: [architecture]\n---\n\n# Angular Architecture\n\n- Keep route containers thin.\n",
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
        content:
          "---\nid: project-admin-dashboard\nkind: rule\ntitle: Admin Dashboard\nstacks: [angular]\ntopics: [dashboard]\n---\n\n# Admin Dashboard\n\n- Prefer existing feature containers over new top-level modules.\n",
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
          "---\nid: shared-component-audit\nkind: skill\ntitle: Component Audit\nname: component-audit\ndescription: Review Angular components before editing.\nstacks: [angular]\ntopics: [components]\n---\n\n# Component Audit\n\n1. Check inputs and outputs.\n",
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
          "---\nid: project-adding-admin-widget\nkind: skill\ntitle: Adding Admin Widget\nname: adding-admin-widget\ndescription: Add a new admin widget in this repository.\nstacks: [angular]\ntopics: [widgets]\n---\n\n# Adding Admin Widget\n\n1. Start from the existing dashboard feature shell.\n",
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
      text: z.string(),
    })
    .parse(resolveAfterUpserts.structuredContent);

  assert.match(resolvedUpserts.text, /### shared\/topics\/angular-architecture\.md/);
  assert.match(resolvedUpserts.text, /### project\/topics\/admin-dashboard\.md/);
  assert.match(resolvedUpserts.text, /### shared\/stacks\/angular\/component-audit\/SKILL\.md/);
  assert.match(resolvedUpserts.text, /### project\/stacks\/angular\/adding-admin-widget\/SKILL\.md/);

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
      text: z.string(),
    })
    .parse(resolveAfterDeletes.structuredContent);

  assert.doesNotMatch(resolvedDeletes.text, /### project\/topics\/admin-dashboard\.md/);
  assert.doesNotMatch(resolvedDeletes.text, /### shared\/stacks\/angular\/component-audit\/SKILL\.md/);
});

test("project entries override shared entries by canonical id instead of path", async (t) => {
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

  await client.callTool({
    name: "upsert_rule",
    arguments: {
      scope: "shared",
      projectPath: projectRoot,
      path: "topics/angular-architecture.md",
      content:
        "---\nid: architecture-boundaries\nkind: rule\ntitle: Architecture Boundaries\nstacks: [angular]\ntopics: [architecture]\n---\n\n# Architecture Boundaries\n\n- Shared baseline architecture rule.\n",
    },
  });

  await client.callTool({
    name: "upsert_rule",
    arguments: {
      scope: "project",
      projectPath: projectRoot,
      path: "topics/admin-architecture.md",
      content:
        "---\nid: architecture-boundaries\nkind: rule\ntitle: Architecture Boundaries\nstacks: [angular]\ntopics: [architecture]\n---\n\n# Architecture Boundaries\n\n- Project-specific architecture override.\n",
    },
  });

  const resolveResult = CallToolResultSchema.parse(
    await client.callTool({
      name: "resolve_context",
      arguments: {
        projectPath: projectRoot,
      },
    }),
  );
  const resolved = z
    .object({
      text: z.string(),
    })
    .parse(resolveResult.structuredContent);

  assert.match(resolved.text, /Project-specific architecture override\./);
  assert.match(resolved.text, /### project\/topics\/admin-architecture\.md/);
  assert.doesNotMatch(resolved.text, /Shared baseline architecture rule\./);
  assert.doesNotMatch(resolved.text, /### shared\/topics\/angular-architecture\.md/);
});
