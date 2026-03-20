import os from "node:os";
import path from "node:path";

export const BANK_DIRECTORY_NAME = ".memory-bank";

export const resolveDefaultBankRoot = (): string => path.join(os.homedir(), BANK_DIRECTORY_NAME);

export const resolveBankRoot = (overridePath?: string): string => {
  if (!overridePath) {
    return resolveDefaultBankRoot();
  }

  return path.resolve(overridePath);
};
