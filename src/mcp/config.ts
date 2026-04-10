import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { McpServerConfig } from "../core/bank/types.js";

export const McpServerConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
  })
  .strict();

const resolveCliEntrypointPath = (): string =>
  realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "mb.js"));

export const createDefaultMcpLaunchConfig = (): Pick<McpServerConfig, "command" | "args"> => ({
  command: realpathSync(process.execPath),
  args: [resolveCliEntrypointPath(), "mcp", "serve"],
});

export const createDefaultMcpServerConfig = (bankRoot: string): McpServerConfig => ({
  schemaVersion: 1,
  transport: "stdio",
  ...createDefaultMcpLaunchConfig(),
  env: {
    MB_BANK_ROOT: bankRoot,
  },
});
