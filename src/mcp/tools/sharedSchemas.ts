import path from "node:path";

import { z } from "zod";

export const AbsoluteProjectPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => path.isAbsolute(value), "Project path must be absolute.")
  .describe("Absolute path to the current repository or working directory.");
