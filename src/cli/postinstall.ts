import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { parseManifest } from "../core/bank/manifest.js";
import { ensureGuidanceBankLaunchers } from "../mcp/launcher.js";
import { resolveDefaultBankRoot } from "../shared/paths.js";

type RefreshLauncherOptions = {
  bankRoot?: string;
};

const hasInitializedBank = async (bankRoot: string): Promise<boolean> => {
  try {
    await access(path.join(bankRoot, "manifest.json"));
    return true;
  } catch {
    return false;
  }
};

export const refreshDefaultMcpLauncherIfInitialized = async (
  options: RefreshLauncherOptions = {},
): Promise<"updated" | "skipped"> => {
  const bankRoot = options.bankRoot ?? resolveDefaultBankRoot();
  const manifestPath = path.join(bankRoot, "manifest.json");

  if (!(await hasInitializedBank(bankRoot))) {
    return "skipped";
  }

  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  await ensureGuidanceBankLaunchers(bankRoot, {
    includeClaudeCodeHook: manifest.enabledProviders.includes("claude-code"),
  });
  return "updated";
};

export const runPostinstall = async (): Promise<void> => {
  await refreshDefaultMcpLauncherIfInitialized();
};
