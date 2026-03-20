import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import test from "node:test";

import { InitService } from "../src/core/init/initService.js";
import type { CommandRunner } from "../src/core/providers/types.js";

const createRecordingCommandRunner = () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  const commandRunner: CommandRunner = async ({ command, args }) => {
    calls.push({ command, args });

    if ((command === "codex" || command === "claude") && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 1,
        stdout: "",
        stderr: "",
      };
    }

    return {
      command,
      args,
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  return {
    calls,
    commandRunner,
  };
};

const createClaudeReconfigureRunner = () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  let claudeAddCalls = 0;

  const commandRunner: CommandRunner = async ({ command, args }) => {
    calls.push({ command, args });

    if (command === "claude" && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 1,
        stdout: "",
        stderr: "No MCP server found with name: memory-bank",
      };
    }

    if (command === "claude" && args[0] === "mcp" && args[1] === "add") {
      claudeAddCalls += 1;

      if (claudeAddCalls === 1) {
        return {
          command,
          args,
          exitCode: 1,
          stdout: "",
          stderr: "MCP server memory-bank already exists in user config",
        };
      }
    }

    return {
      command,
      args,
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  return {
    calls,
    commandRunner,
  };
};

test("init writes provider integration descriptors", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const initService = new InitService();
  const { calls, commandRunner } = createRecordingCommandRunner();

  await initService.run({
    bankRoot,
    commandRunner,
    selectedProviders: ["codex", "claude-code"],
  });

  const codexDescriptor = JSON.parse(await readFile(path.join(bankRoot, "integrations", "codex.json"), "utf8")) as {
    provider: string;
    installationMethod: string;
    scope: string;
    mcpServer: { command: string; args: string[]; env: Record<string, string> };
  };
  const claudeDescriptor = JSON.parse(await readFile(path.join(bankRoot, "integrations", "claude-code.json"), "utf8")) as {
    provider: string;
    scope: string;
    mcpServer: { command: string; args: string[]; env: Record<string, string> };
  };

  assert.equal(codexDescriptor.provider, "codex");
  assert.equal(claudeDescriptor.provider, "claude-code");
  assert.equal(codexDescriptor.installationMethod, "provider-cli");
  assert.equal(codexDescriptor.scope, "user");
  assert.equal(claudeDescriptor.scope, "user");
  assert.equal(codexDescriptor.mcpServer.command, "mb");
  assert.deepEqual(codexDescriptor.mcpServer.args, ["mcp", "serve"]);
  assert.equal(codexDescriptor.mcpServer.env.MB_BANK_ROOT, bankRoot);
  assert.deepEqual(
    calls.map((call) => call.command),
    ["codex", "codex", "claude", "claude"],
  );
});

test("claude integration removes and re-adds the server when it already exists", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const initService = new InitService();
  const { calls, commandRunner } = createClaudeReconfigureRunner();

  const result = await initService.run({
    bankRoot,
    commandRunner,
    selectedProviders: ["claude-code"],
  });

  assert.equal(result.integrations[0]?.action, "reconfigured");
  assert.deepEqual(
    calls.map((call) => `${call.command} ${call.args.slice(0, 3).join(" ")}`),
    ["claude mcp get memory-bank", "claude mcp add --scope", "claude mcp remove --scope", "claude mcp add --scope"],
  );
});

test("init skips re-adding global integrations that are already configured", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "mb-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".memory-bank");
  const initService = new InitService();

  const firstRunner: CommandRunner = async ({ command, args }) => {
    if ((command === "codex" || command === "claude") && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 1,
        stdout: "",
        stderr: "",
      };
    }

    return {
      command,
      args,
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  await initService.run({
    bankRoot,
    commandRunner: firstRunner,
    selectedProviders: ["codex", "cursor", "claude-code"],
  });

  const secondCalls: Array<{ command: string; args: string[] }> = [];
  const secondRunner: CommandRunner = async ({ command, args }) => {
    secondCalls.push({ command, args });

    if (command === "codex" && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 0,
        stdout: JSON.stringify({
          transport: {
            type: "stdio",
            command: "mb",
            args: ["mcp", "serve"],
            env: {
              MB_BANK_ROOT: bankRoot,
            },
          },
        }),
        stderr: "",
      };
    }

    if (command === "claude" && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 0,
        stdout: `memory-bank:
  Scope: User config (available in all your projects)
  Status: ✓ Connected
  Type: stdio
  Command: mb
  Args: mcp serve
  Environment:
    MB_BANK_ROOT=${bankRoot}
`,
        stderr: "",
      };
    }

    return {
      command,
      args,
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const result = await initService.run({
    bankRoot,
    commandRunner: secondRunner,
    selectedProviders: ["codex", "cursor", "claude-code"],
  });

  assert.deepEqual(
    result.integrations.map((integration) => integration.action),
    ["skipped", "skipped", "skipped"],
  );
  assert.deepEqual(
    secondCalls.map((call) => `${call.command} ${call.args[0]} ${call.args[1] ?? ""}`.trim()),
    ["codex mcp get", "claude mcp get"],
  );
});
