import { createHash } from "node:crypto";

import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../bank/canonicalEntry.js";
import type { EntryKind } from "../bank/types.js";
import type { BankRepository } from "../../storage/bankRepository.js";

export type CurrentProjectBankEntrySnapshot = {
  kind: EntryKind;
  scope: "project";
  path: string;
  id: string;
  sha256: string;
};

export type CurrentProjectBankSnapshot = {
  exists: boolean;
  entries: CurrentProjectBankEntrySnapshot[];
};

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

export const discoverCurrentProjectBank = async (
  repository: BankRepository,
  projectId: string,
  exists: boolean,
): Promise<CurrentProjectBankSnapshot> => {
  if (!exists) {
    return {
      exists: false,
      entries: [],
    };
  }

  const [ruleEntries, skillEntries] = await Promise.all([
    repository.listLayerEntries("project", "rules", projectId),
    repository.listLayerEntries("project", "skills", projectId),
  ]);

  const [ruleSnapshots, skillSnapshots] = await Promise.all([
    Promise.all(
      ruleEntries.map(async ({ path }) => {
        const content = await repository.readLayerEntry("project", "rules", path, projectId);
        const document = parseCanonicalRuleDocument(content);

        return {
          kind: "rules" as const,
          scope: "project" as const,
          path,
          id: document.frontmatter.id,
          sha256: sha256(content),
        };
      }),
    ),
    Promise.all(
      skillEntries.map(async ({ path }) => {
        const content = await repository.readLayerEntry("project", "skills", path, projectId);
        const document = parseCanonicalSkillDocument(content);

        return {
          kind: "skills" as const,
          scope: "project" as const,
          path,
          id: document.frontmatter.id,
          sha256: sha256(content),
        };
      }),
    ),
  ]);

  return {
    exists: true,
    entries: [...ruleSnapshots, ...skillSnapshots].sort((left, right) => left.path.localeCompare(right.path)),
  };
};
