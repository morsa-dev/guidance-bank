import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BANK_DIRECTORY_NAME = ".guidancebank";
const LEGACY_BANK_DIRECTORY_NAMES = [".guidance-bank", ".memory-bank"] as const;

export const resolveDefaultBankRoot = (): string => {
  const homeDirectory = os.homedir();
  const defaultBankRoot = path.join(homeDirectory, BANK_DIRECTORY_NAME);

  if (fs.existsSync(defaultBankRoot)) {
    return defaultBankRoot;
  }

  for (const legacyDirectoryName of LEGACY_BANK_DIRECTORY_NAMES) {
    const legacyBankRoot = path.join(homeDirectory, legacyDirectoryName);
    if (fs.existsSync(legacyBankRoot)) {
      return legacyBankRoot;
    }
  }

  return defaultBankRoot;
};

export const resolveBankRoot = (overridePath?: string): string => {
  if (!overridePath) {
    return resolveDefaultBankRoot();
  }

  return path.resolve(overridePath);
};
