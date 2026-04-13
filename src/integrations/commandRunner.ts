import { spawn } from "node:child_process";

import { GuidanceBankCliError } from "../shared/errors.js";
import type { CommandRunResult, CommandRunner } from "../core/providers/types.js";

export const runCommand: CommandRunner = async ({ command, args }) =>
  new Promise<CommandRunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        reject(new GuidanceBankCliError(`Required provider CLI is not installed or not on PATH: ${command}`));
        return;
      }

      reject(error);
    });

    child.on("close", (exitCode) => {
      resolve({
        command,
        args,
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });
