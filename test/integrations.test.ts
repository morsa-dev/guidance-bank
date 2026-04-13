import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { InitService } from "../src/core/init/initService.js";
import { createDefaultMcpServerConfig } from "../src/mcp/config.js";
import { createDefaultMcpLaunchConfig, createMcpLauncherContent, resolveMcpLauncherPath } from "../src/mcp/launcher.js";
import type { CommandRunner } from "../src/core/providers/types.js";

const createExpectedProviderMcpServer = (
  bankRoot: string,
  provider: "codex" | "cursor" | "claude-code",
): { command: string; args: string[]; env: Record<string, string> } => {
  const baseConfig = createDefaultMcpServerConfig(bankRoot);

  return {
    command: baseConfig.command,
    args: [...baseConfig.args],
    env: {
      ...baseConfig.env,
      GUIDANCEBANK_PROVIDER_ID: provider,
    },
  };
};

test("default MCP launch config uses a stable launcher path on Unix and Windows", () => {
  assert.deepEqual(createDefaultMcpLaunchConfig("/tmp/gbank-bank", { platform: "linux" }), {
    command: "/tmp/gbank-bank/bin/guidancebank-mcp",
    args: [],
  });

  assert.deepEqual(
    createDefaultMcpLaunchConfig("C:\\Users\\tester\\.guidancebank", {
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "\"C:\\Users\\tester\\.guidancebank\\bin\\guidancebank-mcp.cmd\""],
    },
  );
});

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
        stderr: "No MCP server found with name: guidance-bank",
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
          stderr: "MCP server guidance-bank already exists in user config",
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

const createClaudeScopedMissingRunner = () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  const commandRunner: CommandRunner = async ({ command, args }) => {
    calls.push({ command, args });

    if (command === "claude" && args[0] === "mcp" && args[1] === "remove") {
      return {
        command,
        args,
        exitCode: 1,
        stdout: "",
        stderr: `No user-scoped MCP server found with name: ${args.at(-1) ?? ""}`,
      };
    }

    if (command === "claude" && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 1,
        stdout: "",
        stderr: "No MCP server found with name: guidance-bank",
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

test("init writes provider integration descriptors", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const { calls, commandRunner } = createRecordingCommandRunner();

  await initService.run({
    bankRoot,
    cursorConfigRoot,
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
  assert.equal(codexDescriptor.mcpServer.command, createDefaultMcpLaunchConfig(bankRoot).command);
  assert.deepEqual(codexDescriptor.mcpServer.args, createDefaultMcpLaunchConfig(bankRoot).args);
  assert.equal(codexDescriptor.mcpServer.env.GUIDANCEBANK_ROOT, bankRoot);
  assert.equal(codexDescriptor.mcpServer.env.GUIDANCEBANK_PROVIDER_ID, "codex");
  assert.equal(claudeDescriptor.mcpServer.env.GUIDANCEBANK_PROVIDER_ID, "claude-code");
  assert.ok(calls.some((call) => call.command === "codex"));
  assert.ok(calls.some((call) => call.command === "claude"));
});

test("init writes the MCP launcher into the bank root", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-launcher-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();

  await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner: createRecordingCommandRunner().commandRunner,
    selectedProviders: ["cursor"],
  });

  const launcherPath = resolveMcpLauncherPath(bankRoot);
  const launcherContents = await readFile(launcherPath, "utf8");

  assert.equal(launcherContents, createMcpLauncherContent());
});

test("claude integration removes and re-adds the server when it already exists", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const { calls, commandRunner } = createClaudeReconfigureRunner();

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
    selectedProviders: ["claude-code"],
  });

  assert.equal(result.integrations[0]?.action, "reconfigured");
  assert.deepEqual(
    calls.map((call) => `${call.command} ${call.args.slice(0, 3).join(" ")}`),
    [
      "claude mcp remove --scope",
      "claude mcp remove --scope",
      "claude mcp get guidance-bank",
      "claude mcp add --scope",
      "claude mcp remove --scope",
      "claude mcp add --scope",
    ],
  );
});

test("init tolerates scoped missing-server messages when cleaning up legacy Claude MCP integrations", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const { calls, commandRunner } = createClaudeScopedMissingRunner();

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
    selectedProviders: ["claude-code"],
  });

  assert.equal(result.integrations[0]?.action, "installed");
  const commandLines = calls.map((call) => `${call.command} ${call.args.join(" ")}`);
  assert.deepEqual(commandLines.slice(0, 3), [
    "claude mcp remove --scope user guidancebank",
    "claude mcp remove --scope user memory-bank-local",
    "claude mcp get guidance-bank",
  ]);
  assert.match(commandLines[3] ?? "", /^claude mcp add --scope user --env=GUIDANCEBANK_ROOT=.* guidance-bank -- /u);
});

test("init skips re-adding global integrations that are already configured", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
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
    cursorConfigRoot,
    commandRunner: firstRunner,
    selectedProviders: ["codex", "claude-code"],
  });

  const secondCalls: Array<{ command: string; args: string[] }> = [];
  const secondRunner: CommandRunner = async ({ command, args }) => {
    secondCalls.push({ command, args });
    const launchConfig = createDefaultMcpLaunchConfig(bankRoot);

    if (command === "codex" && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 0,
        stdout: JSON.stringify({
          transport: {
            type: "stdio",
            command: launchConfig.command,
            args: launchConfig.args,
            env: {
              GUIDANCEBANK_ROOT: bankRoot,
              GUIDANCEBANK_PROVIDER_ID: "codex",
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
        stdout: `guidance-bank:
  Scope: User config (available in all your projects)
  Status: ✓ Connected
  Type: stdio
  Command: ${launchConfig.command}
  Args: ${launchConfig.args.join(" ")}
  Environment:
    GUIDANCEBANK_ROOT=${bankRoot}
    GUIDANCEBANK_PROVIDER_ID=claude-code
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
    cursorConfigRoot,
    commandRunner: secondRunner,
    selectedProviders: ["codex", "claude-code"],
  });

  assert.deepEqual(
    result.integrations.map((integration) => integration.action),
    ["skipped", "skipped"],
  );
  assert.deepEqual(
    secondCalls.map((call) => `${call.command} ${call.args[0]} ${call.args[1] ?? ""}`.trim()),
    [
      "codex mcp remove",
      "codex mcp remove",
      "codex mcp get",
      "claude mcp remove",
      "claude mcp remove",
      "claude mcp get",
    ],
  );
});

test("repeat init re-applies missing codex and claude MCP registrations", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();

  await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner: createRecordingCommandRunner().commandRunner,
    selectedProviders: ["codex", "claude-code"],
  });

  const secondCalls: Array<{ command: string; args: string[] }> = [];
  const secondRunner: CommandRunner = async ({ command, args }) => {
    secondCalls.push({ command, args });

    if (command === "codex" && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 1,
        stdout: "",
        stderr: "No MCP server found with name: guidance-bank",
      };
    }

    if (command === "claude" && args[0] === "mcp" && args[1] === "get") {
      return {
        command,
        args,
        exitCode: 1,
        stdout: "",
        stderr: "No MCP server found with name: guidance-bank",
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
    cursorConfigRoot,
    commandRunner: secondRunner,
    selectedProviders: ["codex"],
  });

  assert.deepEqual(
    result.integrations.map((integration) => integration.action),
    ["installed", "installed"],
  );
  assert.deepEqual(
    secondCalls.map((call) => `${call.command} ${call.args[0]} ${call.args[1] ?? ""}`.trim()),
    [
      "codex mcp remove",
      "codex mcp remove",
      "codex mcp get",
      "codex mcp add",
      "claude mcp remove",
      "claude mcp remove",
      "claude mcp get",
      "claude mcp add",
    ],
  );
});

test("cursor integration writes the MCP config file and persists a config-file descriptor", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const { calls, commandRunner } = createRecordingCommandRunner();

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
    selectedProviders: ["cursor"],
  });

  const cursorDescriptor = JSON.parse(
    await readFile(path.join(bankRoot, "integrations", "cursor.json"), "utf8"),
  ) as {
    installationMethod: string;
    serverName: string;
  };
  const cursorConfig = JSON.parse(await readFile(path.join(cursorConfigRoot, "mcp.json"), "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  };

  assert.equal(result.integrations[0]?.action, "installed");
  assert.equal(result.integrations[0]?.command, null);
  assert.equal(cursorDescriptor.installationMethod, "config-file");
  assert.equal(cursorDescriptor.serverName, "guidance-bank");
  assert.deepEqual(cursorConfig.mcpServers["guidance-bank"], createExpectedProviderMcpServer(bankRoot, "cursor"));
  assert.ok(!calls.some((call) => call.command === "cursor"));
});

test("repeat init skips cursor when the expected MCP config already exists", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const { commandRunner } = createRecordingCommandRunner();

  await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
    selectedProviders: ["cursor"],
  });

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
    selectedProviders: ["cursor"],
  });

  assert.equal(result.integrations[0]?.action, "skipped");
});

test("repeat init reconfigures cursor when the MCP config entry exists but does not match", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const { commandRunner } = createRecordingCommandRunner();

  await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
    selectedProviders: ["cursor"],
  });

  await writeFile(
    path.join(cursorConfigRoot, "mcp.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          "guidance-bank": {
            ...createExpectedProviderMcpServer(bankRoot, "cursor"),
            env: {
              GUIDANCEBANK_ROOT: "/wrong/path",
              GUIDANCEBANK_PROVIDER_ID: "cursor",
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
    selectedProviders: ["cursor"],
  });

  const cursorConfig = JSON.parse(await readFile(path.join(cursorConfigRoot, "mcp.json"), "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  };

  assert.equal(result.integrations[0]?.action, "reconfigured");
  assert.deepEqual(cursorConfig.mcpServers["guidance-bank"], createExpectedProviderMcpServer(bankRoot, "cursor"));
});

test("repeat init reconfigures cursor even if a stale descriptor exists but the MCP config file is missing", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-integrations-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidancebank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const initService = new InitService();
  const { commandRunner } = createRecordingCommandRunner();

  await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
    selectedProviders: ["cursor"],
  });

  await writeFile(
    path.join(bankRoot, "integrations", "cursor.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        provider: "cursor",
        displayName: "Cursor",
        serverName: "guidance-bank",
        installationMethod: "config-file",
        scope: "user",
        mcpServer: {
          schemaVersion: 1,
          transport: "stdio",
          ...createExpectedProviderMcpServer(bankRoot, "cursor"),
        },
        instructions: [],
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(path.join(cursorConfigRoot, "mcp.json"), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);

  const result = await initService.run({
    bankRoot,
    cursorConfigRoot,
    commandRunner,
    selectedProviders: ["cursor"],
  });

  assert.equal(result.integrations[0]?.action, "installed");
});
