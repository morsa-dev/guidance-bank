export type BankContentMigrationLayer = "shared" | "project";
export type BankContentMigrationEntryKind = "rules" | "skills";
export type BankContentMigrationResolutionKind =
  | "choose_single_stack"
  | "make_always_on"
  | "split_into_separate_entries"
  | "convert_to_rule_entry"
  | "convert_to_skill_entry"
  | "move_outside_bank"
  | "remove_file";

export type BankContentMigrationAutoMigration = {
  scope: BankContentMigrationLayer;
  kind: BankContentMigrationEntryKind;
  projectId: string | null;
  fromPath: string;
  toPath: string;
  pathChange: string | null;
  frontmatterChanges: string[];
  safeBeforeResolution: boolean;
};

export type BankContentMigrationResolutionIssue = {
  reason: "multi_stack_frontmatter" | "entry_selector_resolution" | "path_collision" | "unsupported_entry_file";
  scope: BankContentMigrationLayer;
  kind: BankContentMigrationEntryKind;
  projectId: string | null;
  path: string;
  id: string | null;
  title: string | null;
  legacyFrontmatter: string[];
  requiredCurrentFrontmatter: string[];
  resolutionPrinciple: string;
  allowedResolutions: BankContentMigrationResolutionKind[];
  agentNextStep: string;
  collidingPaths?: string[];
};

export type BankContentMigrationPreflight = {
  autoMigrations: BankContentMigrationAutoMigration[];
  requiresResolution: BankContentMigrationResolutionIssue[];
};

export type BankContentMigrationApplyResult = {
  appliedMigrations: BankContentMigrationAutoMigration[];
};
