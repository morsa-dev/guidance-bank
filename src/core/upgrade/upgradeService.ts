import path from "node:path";
import { promises as fs } from "node:fs";

import { InitService } from "../init/initService.js";
import { BankRepository } from "../../storage/bankRepository.js";
import { ValidationError } from "../../shared/errors.js";
import { BANK_DIRECTORY_NAME, LEGACY_BANK_DIRECTORY_NAMES, resolveBankRoot } from "../../shared/paths.js";
import { CURRENT_STORAGE_VERSION, type MemoryBankManifest } from "../bank/types.js";
import { isCurrentStorageVersion, updateManifest } from "../bank/manifest.js";
import type { CommandRunner } from "../providers/types.js";
import {
  inspectBankContentMigration,
  migrateBankContentLayout,
  migrateSafeBankContentLayout,
  type BankContentMigrationAutoMigration,
  type BankContentMigrationResolutionIssue,
} from "./bankContentMigration.js";

export type BankUpgradeDetection =
  | {
      status: "not_initialized";
      bankRoot: string;
      expectedStorageVersion: typeof CURRENT_STORAGE_VERSION;
    }
  | {
      status: "up_to_date";
      bankRoot: string;
      manifest: MemoryBankManifest;
      expectedStorageVersion: typeof CURRENT_STORAGE_VERSION;
    }
  | {
      status: "upgrade_required";
      bankRoot: string;
      sourceRoot: string;
      manifest: MemoryBankManifest;
      expectedStorageVersion: typeof CURRENT_STORAGE_VERSION;
      reason: "storage_version" | "legacy_root";
    };

type UpgradeBankResultBase = {
  bankRoot: string;
  sourceRoot: string;
  migratedBankRoot: boolean;
  previousStorageVersion: number;
  storageVersion: number;
  enabledProviders: string[];
  autoMigrations: BankContentMigrationAutoMigration[];
  requiresResolution: BankContentMigrationResolutionIssue[];
};

export type UpgradeBankResult =
  | (UpgradeBankResultBase & {
      status: "upgraded" | "already_current";
    })
  | (UpgradeBankResultBase & {
      status: "needs_resolution";
      resolutionInstructions: string[];
    });

const resolveLegacyBankRoots = (bankRoot: string): string[] => {
  const resolvedBankRoot = path.resolve(bankRoot);
  if (path.basename(resolvedBankRoot) !== BANK_DIRECTORY_NAME) {
    return [];
  }

  return LEGACY_BANK_DIRECTORY_NAMES.map((directoryName) => path.join(path.dirname(resolvedBankRoot), directoryName));
};

const moveBankRoot = async (sourceRoot: string, targetRoot: string): Promise<void> => {
  if (sourceRoot === targetRoot) {
    return;
  }

  try {
    await fs.access(targetRoot);
    throw new ValidationError(`Cannot upgrade AI Guidance Bank into an existing path: ${targetRoot}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(targetRoot), { recursive: true });

  try {
    await fs.rename(sourceRoot, targetRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }

    await fs.cp(sourceRoot, targetRoot, { recursive: true });
    await fs.rm(sourceRoot, { recursive: true, force: true });
  }
};

export const detectBankUpgrade = async (bankRoot?: string): Promise<BankUpgradeDetection> => {
  const resolvedBankRoot = resolveBankRoot(bankRoot);
  const repository = new BankRepository(resolvedBankRoot);
  const manifest = await repository.readManifestOptional();

  if (manifest !== null) {
    if (isCurrentStorageVersion(manifest.storageVersion)) {
      return {
        status: "up_to_date",
        bankRoot: resolvedBankRoot,
        manifest,
        expectedStorageVersion: CURRENT_STORAGE_VERSION,
      };
    }

    return {
      status: "upgrade_required",
      bankRoot: resolvedBankRoot,
      sourceRoot: resolvedBankRoot,
      manifest,
      expectedStorageVersion: CURRENT_STORAGE_VERSION,
      reason: "storage_version",
    };
  }

  const legacyMatches: Array<{ legacyBankRoot: string; manifest: MemoryBankManifest }> = [];
  for (const legacyBankRoot of resolveLegacyBankRoots(resolvedBankRoot)) {
    const legacyRepository = new BankRepository(legacyBankRoot);
    const legacyManifest = await legacyRepository.readManifestOptional();

    if (legacyManifest !== null) {
      legacyMatches.push({ legacyBankRoot, manifest: legacyManifest });
    }
  }

  if (legacyMatches.length > 1) {
    throw new ValidationError(
      `Multiple legacy AI Guidance Bank roots were found: ${legacyMatches.map(({ legacyBankRoot }) => legacyBankRoot).join(", ")}. Resolve them manually before upgrading.`,
    );
  }

  if (legacyMatches.length === 1) {
    const legacyMatch = legacyMatches[0]!;
    return {
      status: "upgrade_required",
      bankRoot: resolvedBankRoot,
      sourceRoot: legacyMatch.legacyBankRoot,
      manifest: legacyMatch.manifest,
      expectedStorageVersion: CURRENT_STORAGE_VERSION,
      reason: "legacy_root",
    };
  }

  return {
    status: "not_initialized",
    bankRoot: resolvedBankRoot,
    expectedStorageVersion: CURRENT_STORAGE_VERSION,
  };
};

export class UpgradeService {
  async run(options?: {
    bankRoot?: string;
    cursorConfigRoot?: string;
    claudeConfigRoot?: string;
    commandRunner?: CommandRunner;
  }): Promise<UpgradeBankResult> {
    const detection = await detectBankUpgrade(options?.bankRoot);

    if (detection.status === "not_initialized") {
      throw new ValidationError(`AI Guidance Bank is not initialized yet. Run \`gbank init\` first.`);
    }

    if (detection.status === "up_to_date") {
      const repository = new BankRepository(detection.bankRoot);
      const safeContentMigrationResult = await migrateSafeBankContentLayout(repository);
      const contentPreflight = await inspectBankContentMigration(repository);

      if (contentPreflight.requiresResolution.length > 0) {
        return {
          status: "needs_resolution",
          bankRoot: detection.bankRoot,
          sourceRoot: detection.bankRoot,
          migratedBankRoot: false,
          previousStorageVersion: detection.manifest.storageVersion,
          storageVersion: detection.manifest.storageVersion,
          enabledProviders: detection.manifest.enabledProviders,
          autoMigrations: contentPreflight.autoMigrations,
          requiresResolution: contentPreflight.requiresResolution,
          resolutionInstructions: [
            `Applied ${safeContentMigrationResult.appliedMigrations.length} safe layout migration${safeContentMigrationResult.appliedMigrations.length === 1 ? "" : "s"} before asking for explicit decisions.`,
            "The bank storage version remains unchanged because one or more entries still need explicit selector decisions.",
            "For each requiresResolution item, read the listed entry and rewrite only the frontmatter selector.",
            "Current selector metadata is explicit: use exactly one of `stack: <canonical-id>` or `alwaysOn: true`.",
            "Prefer a concrete `stack` selector when the path, legacy stacks, title, or body points to one technology. Use `alwaysOn: true` only for genuinely global guidance.",
            "Never keep `stacks`, never omit the selector, and never use both `stack` and `alwaysOn` in current canonical entries.",
            "For unsupported visible files inside rules or skills roots, either convert them to canonical entries, move them outside the bank, or delete them if they are obsolete.",
            "After saving all corrected entries, call `upgrade_bank` again. The next run will re-scan the bank and apply the automatic migrations if no unresolved items remain.",
          ],
        };
      }

      const contentMigrationResult = await migrateBankContentLayout(repository, contentPreflight);
      const autoMigrations = [...safeContentMigrationResult.appliedMigrations, ...contentMigrationResult.appliedMigrations];

      return {
        status: autoMigrations.length > 0 ? "upgraded" : "already_current",
        bankRoot: detection.bankRoot,
        sourceRoot: detection.bankRoot,
        migratedBankRoot: false,
        previousStorageVersion: detection.manifest.storageVersion,
        storageVersion: detection.manifest.storageVersion,
        enabledProviders: detection.manifest.enabledProviders,
        autoMigrations,
        requiresResolution: [],
      };
    }

    if (detection.reason === "legacy_root") {
      await moveBankRoot(detection.sourceRoot, detection.bankRoot);
    }

    const repository = new BankRepository(detection.bankRoot);
    const manifestBeforeUpgrade = await repository.readManifest();
    const initService = new InitService();
    const safeContentMigrationResult = await migrateSafeBankContentLayout(repository);
    const contentPreflight = await inspectBankContentMigration(repository);

    if (contentPreflight.requiresResolution.length > 0) {
      return {
        status: "needs_resolution",
        bankRoot: detection.bankRoot,
        sourceRoot: detection.sourceRoot,
        migratedBankRoot: detection.sourceRoot !== detection.bankRoot,
        previousStorageVersion: detection.manifest.storageVersion,
        storageVersion: manifestBeforeUpgrade.storageVersion,
        enabledProviders: manifestBeforeUpgrade.enabledProviders,
        autoMigrations: contentPreflight.autoMigrations,
        requiresResolution: contentPreflight.requiresResolution,
        resolutionInstructions: [
          `Applied ${safeContentMigrationResult.appliedMigrations.length} safe layout migration${safeContentMigrationResult.appliedMigrations.length === 1 ? "" : "s"} before asking for explicit decisions.`,
          "The bank storage version was not bumped because one or more legacy entries still need explicit selector decisions.",
          "For each requiresResolution item, read the listed entry and rewrite only the frontmatter selector.",
          "Current selector metadata is explicit: use exactly one of `stack: <canonical-id>` or `alwaysOn: true`.",
          "Prefer a concrete `stack` selector when the path, legacy stacks, title, or body points to one technology. Use `alwaysOn: true` only for genuinely global guidance.",
          "Never keep `stacks`, never omit the selector, and never use both `stack` and `alwaysOn` in current canonical entries.",
          "For unsupported visible files inside rules or skills roots, either convert them to canonical entries, move them outside the bank, or delete them if they are obsolete.",
          "After saving all corrected entries, call `upgrade_bank` again. The next run will re-scan the bank and apply the automatic migrations if no unresolved items remain.",
        ],
      };
    }

    const contentMigrationResult = await migrateBankContentLayout(repository, contentPreflight);

    await initService.run({
      bankRoot: detection.bankRoot,
      selectedProviders: manifestBeforeUpgrade.enabledProviders,
      ...(options?.cursorConfigRoot ? { cursorConfigRoot: options.cursorConfigRoot } : {}),
      ...(options?.claudeConfigRoot ? { claudeConfigRoot: options.claudeConfigRoot } : {}),
      ...(options?.commandRunner ? { commandRunner: options.commandRunner } : {}),
    });

    await repository.writeManifest(
      updateManifest(manifestBeforeUpgrade, manifestBeforeUpgrade.enabledProviders, new Date(), {
        storageVersion: CURRENT_STORAGE_VERSION,
      }),
    );

    const upgradedManifest = await repository.readManifest();

    return {
      status: "upgraded",
      bankRoot: detection.bankRoot,
      sourceRoot: detection.sourceRoot,
      migratedBankRoot: detection.sourceRoot !== detection.bankRoot,
      previousStorageVersion: detection.manifest.storageVersion,
      storageVersion: upgradedManifest.storageVersion,
      enabledProviders: upgradedManifest.enabledProviders,
      autoMigrations: [...safeContentMigrationResult.appliedMigrations, ...contentMigrationResult.appliedMigrations],
      requiresResolution: [],
    };
  }
}
