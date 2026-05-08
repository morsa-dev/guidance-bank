import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import test from "node:test";

import { InitService } from "../src/core/init/initService.js";
import { StopService } from "../src/core/stop/stopService.js";
import type { CommandRunner } from "../src/core/providers/types.js";

const createInitCommandRunner = (): CommandRunner => async ({ command, args }) => ({
  command,
  args,
  exitCode: command === "codex" && args[1] === "get" ? 1 : command === "claude" && args[1] === "get" ? 1 : 0,
  stdout: "",
  stderr: "",
});

test("stop removes active MCP integrations without deleting the bank", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-stop-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const claudeConfigRoot = path.join(tempDirectoryPath, ".claude");

  await new InitService().run({
    bankRoot,
    cursorConfigRoot,
    claudeConfigRoot,
    commandRunner: createInitCommandRunner(),
    selectedProviders: ["codex", "cursor", "claude-code"],
  });

  const calls: Array<{ command: string; args: string[] }> = [];
  const stopRunner: CommandRunner = async ({ command, args }) => {
    calls.push({ command, args });
    return {
      command,
      args,
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  };

  const result = await new StopService().run({
    bankRoot,
    cursorConfigRoot,
    claudeConfigRoot,
    commandRunner: stopRunner,
  });

  assert.deepEqual(result.enabledProviders, ["codex", "cursor", "claude-code"]);
  assert.deepEqual(
    result.stoppedProviders.map((provider) => [provider.provider, provider.action]),
    [
      ["codex", "removed"],
      ["cursor", "removed"],
      ["claude-code", "removed"],
    ],
  );
  assert.deepEqual(
    calls.map((call) => `${call.command} ${call.args.join(" ")}`),
    [
      "codex mcp remove guidancebank",
      "codex mcp remove memory-bank-local",
      "codex mcp remove guidance-bank",
      "claude mcp remove --scope user guidancebank",
      "claude mcp remove --scope user memory-bank-local",
      "claude mcp remove --scope user guidance-bank",
    ],
  );

  const manifest = JSON.parse(await readFile(path.join(bankRoot, "manifest.json"), "utf8")) as {
    enabledProviders: string[];
  };
  assert.deepEqual(manifest.enabledProviders, ["codex", "cursor", "claude-code"]);

  const cursorConfig = JSON.parse(await readFile(path.join(cursorConfigRoot, "mcp.json"), "utf8")) as {
    mcpServers: Record<string, unknown>;
  };
  assert.deepEqual(cursorConfig.mcpServers, {});
  const claudeSettings = JSON.parse(await readFile(path.join(claudeConfigRoot, "settings.json"), "utf8")) as {
    hooks?: { PreToolUse?: Array<{ matcher?: string }> };
  };
  assert.equal(
    claudeSettings.hooks?.PreToolUse?.some((group) => group.matcher === "mcp__guidance-bank__.*") ?? false,
    false,
  );
});

test("stop is idempotent when MCP integrations are already absent", async () => {
  const tempDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gbank-cli-stop-"));
  const bankRoot = path.join(tempDirectoryPath, ".guidance-bank");
  const cursorConfigRoot = path.join(tempDirectoryPath, ".cursor");
  const claudeConfigRoot = path.join(tempDirectoryPath, ".claude");

  await new InitService().run({
    bankRoot,
    cursorConfigRoot,
    claudeConfigRoot,
    commandRunner: createInitCommandRunner(),
    selectedProviders: ["codex", "cursor", "claude-code"],
  });

  const stopRunner: CommandRunner = async ({ command, args }) => {
    if ((command === "codex" || command === "claude") && args[0] === "mcp" && args[1] === "remove") {
      return {
        command,
        args,
        exitCode: 1,
        stdout: "",
        stderr: `No MCP server found with name: ${args.at(-1) ?? ""}`,
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

  await new StopService().run({
    bankRoot,
    cursorConfigRoot,
    claudeConfigRoot,
    commandRunner: stopRunner,
  });

  const result = await new StopService().run({
    bankRoot,
    cursorConfigRoot,
    claudeConfigRoot,
    commandRunner: stopRunner,
  });

  assert.deepEqual(
    result.stoppedProviders.map((provider) => [provider.provider, provider.action]),
    [
      ["codex", "already_absent"],
      ["cursor", "already_absent"],
      ["claude-code", "already_absent"],
    ],
  );
});
