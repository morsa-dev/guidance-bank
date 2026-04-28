import { createHash } from "node:crypto";

import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../bank/canonicalEntry.js";
import type { CurrentProjectBankSnapshot } from "./discoverCurrentProjectBank.js";
import type { ProjectLocalEntryStore } from "../../storage/projectLocalEntryStore.js";

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

export const discoverProjectLocalBank = async (
  store: ProjectLocalEntryStore,
  exists: boolean,
): Promise<CurrentProjectBankSnapshot> => {
  if (!exists) {
    return { exists: false, entries: [] };
  }

  const [ruleEntries, skillEntries] = await Promise.all([
    store.listEntries("rules"),
    store.listEntries("skills"),
  ]);

  const [ruleSnapshots, skillSnapshots] = await Promise.all([
    Promise.all(
      ruleEntries.map(async ({ path }) => {
        const content = await store.readEntry("rules", path);
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
        const content = await store.readEntry("skills", path);
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
    entries: [...ruleSnapshots, ...skillSnapshots].sort((a, b) => a.path.localeCompare(b.path)),
  };
};
