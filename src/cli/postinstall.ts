import { access } from "node:fs/promises";
import path from "node:path";

import { ensureMcpLauncher } from "../mcp/launcher.js";
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

  if (!(await hasInitializedBank(bankRoot))) {
    return "skipped";
  }

  await ensureMcpLauncher(bankRoot);
  return "updated";
};

export const runPostinstall = async (): Promise<void> => {
  await refreshDefaultMcpLauncherIfInitialized();
};
