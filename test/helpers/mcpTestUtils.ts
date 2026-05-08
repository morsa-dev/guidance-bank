import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { InitService } from "../../src/core/init/initService.js";
import type { CommandRunner } from "../../src/core/providers/types.js";
import { BankRepository } from "../../src/storage/bankRepository.js";
import { createMcpServer } from "../../src/mcp/createMcpServer.js";

export const execFileAsync = promisify(execFile);

export const createSuccessfulCommandRunner = (): CommandRunner => async ({ command, args }) => ({
  command,
  args,
  exitCode: command === "codex" && args[1] === "get" ? 1 : command === "claude" && args[1] === "get" ? 1 : 0,
  stdout: "",
  stderr: "",
});

export const createInitializedBank = async (options: { selectedProviders?: Array<"codex" | "cursor" | "claude-code"> } = {}) => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-mcp-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const homePath = path.join(tempDirectoryPath, "home");

  await mkdir(homePath, { recursive: true });
  process.env.HOME = homePath;

  await new InitService().run({
    bankRoot,
    cursorConfigRoot,
    commandRunner: createSuccessfulCommandRunner(),
    selectedProviders: options.selectedProviders ?? ["cursor"],
  });

  return {
    tempDirectoryPath,
    bankRoot,
    homePath,
    repository: new BankRepository(bankRoot),
  };
};

export const createConnectedClient = async (bankRoot: string, options: { provider?: "codex" | "cursor" | "claude-code" } = {}) => {
  const server = createMcpServer({ bankRoot, provider: options.provider ?? null });
  const client = new Client({
    name: "gbank-cli-test-client",
    version: "0.0.0",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const close = async () => {
    await Promise.allSettled([client.close(), server.close()]);
  };

  return { client, close };
};

export const writeProjectFiles = async (projectRoot: string, files: Record<string, string>): Promise<void> => {
  await mkdir(projectRoot, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
};

export const initGitRepo = async (projectRoot: string, message = "init project"): Promise<void> => {
  await execFileAsync("git", ["init"], { cwd: projectRoot });
  await execFileAsync("git", ["config", "user.email", "gbank-cli@example.com"], { cwd: projectRoot });
  await execFileAsync("git", ["config", "user.name", "gbank-cli"], { cwd: projectRoot });
  await execFileAsync("git", ["add", "."], { cwd: projectRoot });
  await execFileAsync("git", ["commit", "-m", message], { cwd: projectRoot });
};

export const callToolResult = async (
  client: Client,
  name: string,
  args: Record<string, unknown>,
) => CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));

export const callToolStructured = async <TSchema extends z.ZodTypeAny>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  schema: TSchema,
): Promise<z.infer<TSchema>> => schema.parse((await callToolResult(client, name, args)).structuredContent);

export const TextPayloadSchema = z.object({
  text: z.string(),
  creationState: z.enum(["unknown", "postponed", "declined", "creating", "ready"]).optional(),
  projectLocalBankDisabled: z.boolean().optional(),
  postponedUntil: z.string().nullable().optional(),
  requiredAction: z.enum(["upgrade_bank", "create_bank", "continue_create_bank", "sync_bank"]).optional(),
  recommendedAction: z.enum(["create_bank"]).optional(),
  createFlowPhase: z.string().optional(),
  nextIteration: z.number().int().nonnegative().optional(),
  bankRoot: z.string().optional(),
  sourceRoot: z.string().optional(),
  expectedStorageVersion: z.number().int().positive().optional(),
  storageVersion: z.number().int().positive().optional(),
  detectedStacks: z.array(z.string()).optional(),
  rulesCatalog: z
    .array(
      z.object({
        scope: z.enum(["shared", "project"]),
        kind: z.literal("rules"),
        path: z.string(),
        title: z.string(),
        topics: z.array(z.string()),
        description: z.string().nullable().optional(),
      }),
    )
    .optional(),
  skillsCatalog: z
    .array(
      z.object({
        scope: z.enum(["shared", "project"]),
        kind: z.literal("skills"),
        path: z.string(),
        title: z.string(),
        topics: z.array(z.string()),
        description: z.string().nullable().optional(),
      }),
    )
    .optional(),
});
