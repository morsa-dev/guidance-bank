#!/usr/bin/env node

import { parseArgs } from "node:util";

import { runInitCommand } from "./commands/init.js";
import { runMcpServeCommand } from "./commands/mcpServe.js";
import { MbCliError } from "../shared/errors.js";

const printUsage = (): void => {
  console.info(`mb-cli

Usage:
  mb init
  mb mcp serve
`);
};

const main = async (): Promise<void> => {
  const parsedArgs = parseArgs({
    allowPositionals: true,
    options: {
      help: {
        type: "boolean",
        short: "h",
      },
    },
  });

  if (parsedArgs.values.help) {
    printUsage();
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
  throw new MbCliError("Unsupported command.");
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
