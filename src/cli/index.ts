#!/usr/bin/env node

import { createRequire } from "node:module";
import { parseArgs } from "node:util";

import { runInitCommand } from "./commands/init.js";
import { runMcpServeCommand } from "./commands/mcpServe.js";
import { runStatsCommand } from "./commands/stats.js";
import { GuidanceBankCliError } from "../shared/errors.js";

type PackageJson = {
  version: string;
};

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as PackageJson;

const printUsage = (): void => {
  console.info(`AI Guidance Bank

Usage:
  gbank init
  gbank stats [--project /absolute/project/path] [--json]
  gbank mcp serve

Options:
  -h, --help
  -v, --version
`);
};

const main = async (): Promise<void> => {
  const rawArgv = process.argv.slice(2);
  const [rawCommand, rawSubcommand] = rawArgv;

  if (rawCommand === "stats" && !["serve"].includes(rawSubcommand ?? "")) {
    await runStatsCommand(rawArgv);
    return;
  }

  const parsedArgs = parseArgs({
    allowPositionals: true,
    options: {
      help: {
        type: "boolean",
        short: "h",
      },
      version: {
        type: "boolean",
        short: "v",
      },
    },
  });

  if (parsedArgs.values.help) {
    printUsage();
    return;
  }

  if (parsedArgs.values.version) {
    console.info(packageJson.version);
    return;
  }

  const [command, subcommand] = parsedArgs.positionals;

  if (command === "init" && !subcommand) {
    await runInitCommand();
    return;
  }

  if (command === "mcp" && subcommand === "serve") {
    await runMcpServeCommand();
    return;
  }

  printUsage();
  throw new GuidanceBankCliError("Unsupported command.");
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
