import { z } from "zod";

import type { McpServerConfig } from "../core/bank/types.js";
import { createDefaultMcpLaunchConfig } from "./launcher.js";

export const McpServerConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
  })
  .strict();

export const createDefaultMcpServerConfig = (bankRoot: string): McpServerConfig => ({
  schemaVersion: 1,
  transport: "stdio",
  ...createDefaultMcpLaunchConfig(bankRoot),
  env: {
    MB_BANK_ROOT: bankRoot,
  },
});
