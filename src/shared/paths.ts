import os from "node:os";
import path from "node:path";

export const BANK_DIRECTORY_NAME = ".guidance-bank";
export const LEGACY_BANK_DIRECTORY_NAMES = [".guidancebank", ".memory-bank"] as const;

export const resolveDefaultBankRoot = (): string => path.join(os.homedir(), BANK_DIRECTORY_NAME);

export const resolveBankRoot = (overridePath?: string): string => {
  if (!overridePath) {
    return resolveDefaultBankRoot();
  }

  return path.resolve(overridePath);
};
