import { createHash } from "node:crypto";

import { parseCanonicalRuleDocument, parseCanonicalSkillDocument } from "../bank/canonicalEntry.js";
import type { EntryKind } from "../bank/types.js";
import type { AuditEntrySnapshot } from "./types.js";

const countLines = (content: string): number => (content.length === 0 ? 0 : content.split(/\r?\n/u).length);

export const summarizeEntryContent = (kind: EntryKind, content: string | null): AuditEntrySnapshot => {
  if (content === null) {
    return {
      exists: false,
      sha256: null,
      charCount: 0,
      lineCount: 0,
      entryId: null,
      title: null,
      entryKind: null,
      stack: null,
      topics: [],
    };
  }

  const baseSummary: AuditEntrySnapshot = {
    exists: true,
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    charCount: content.length,
    lineCount: countLines(content),
    entryId: null,
    title: null,
    entryKind: null,
    stack: null,
    topics: [],
  };

  try {
    const document = kind === "rules" ? parseCanonicalRuleDocument(content) : parseCanonicalSkillDocument(content);

    return {
      ...baseSummary,
      entryId: document.frontmatter.id,
      title: document.frontmatter.title,
      entryKind: document.frontmatter.kind,
      stack: document.frontmatter.stack ?? null,
      topics: [...document.frontmatter.topics],
    };
  } catch {
    return baseSummary;
  }
};
