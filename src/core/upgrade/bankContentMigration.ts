import type { BankRepository } from "../../storage/bankRepository.js";
import { ValidationError } from "../../shared/errors.js";
import {
  applyV2ToV3ContentMigration,
  applyV2ToV3SafeContentMigrations,
  inspectV2ToV3ContentMigration,
} from "./migrations/v2ToV3ContentMigration.js";
import type { BankContentMigrationApplyResult, BankContentMigrationPreflight } from "./bankContentMigrationTypes.js";

export type {
  BankContentMigrationAutoMigration,
  BankContentMigrationEntryKind,
  BankContentMigrationLayer,
  BankContentMigrationPreflight,
  BankContentMigrationResolutionIssue,
  BankContentMigrationResolutionKind,
} from "./bankContentMigrationTypes.js";

export const inspectBankContentMigration = (repository: BankRepository) => inspectV2ToV3ContentMigration(repository);

export const migrateSafeBankContentLayout = async (repository: BankRepository): Promise<BankContentMigrationApplyResult> => {
  const beforePreflight = await inspectBankContentMigration(repository);
  const safeMigrations = beforePreflight.autoMigrations.filter((migration) => migration.safeBeforeResolution);

  await applyV2ToV3SafeContentMigrations(repository);

  return {
    appliedMigrations: safeMigrations,
  };
};

export const migrateBankContentLayout = async (
  repository: BankRepository,
  preflight: BankContentMigrationPreflight,
): Promise<BankContentMigrationApplyResult> => {
  if (preflight.requiresResolution.length > 0) {
    throw new ValidationError("Cannot apply bank content migration while explicit resolutions are still required.");
  }

  await applyV2ToV3ContentMigration(repository);

  return {
    appliedMigrations: [...preflight.autoMigrations],
  };
};
