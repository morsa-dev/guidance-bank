import path from "node:path";
import { readFile } from "node:fs/promises";

import type { ExistingGuidanceSource } from "../discoverExistingGuidance.js";

export type GuidanceCandidateKind = "rule" | "skill";

export type GuidanceCandidate = {
  sourceRef: string;
  title: string;
  summary: string;
  kind: GuidanceCandidateKind;
};

export type ReviewableGuidanceSource = ExistingGuidanceSource & {
  candidates: GuidanceCandidate[];
  fullCoverage: boolean;
};

const MAX_GUIDANCE_SOURCE_BYTES = 128_000;

const GUIDANCE_SIGNAL_PATTERN =
  /\b(should|must|prefer|use|keep|avoid|follow|treat|never|always|when|if|do not|don't|only|before|after)\b/i;

const stripFrontmatter = (content: string): string => {
  if (!content.startsWith("---\n")) {
    return content;
  }

  const closingIndex = content.indexOf("\n---\n", 4);
  return closingIndex === -1 ? content : content.slice(closingIndex + 5);
};

const stripCodeFences = (content: string): string => content.replace(/```[\s\S]*?```/g, "");

const isLikelyStructuredConfig = (trimmed: string): boolean =>
  trimmed.startsWith("{") ||
  trimmed.startsWith("[") ||
  (trimmed.startsWith("---") && !/\n#/.test(trimmed));

const isLikelyCommandLine = (line: string): boolean =>
  /^[-*]\s*`[^`]+`(?:\s*[-:]\s*.+)?$/.test(line) || /^\d+\.\s*`[^`]+`(?:\s*[-:]\s*.+)?$/.test(line);

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

const toSummary = (lines: readonly string[]): string =>
  normalizeWhitespace(lines.slice(0, 2).join(" ")).slice(0, 180);

const inferCandidateKind = (title: string, body: string): GuidanceCandidateKind => {
  const combined = `${title}\n${body}`;
  return /\b(workflow|when to use|steps|step |how to|procedure|checklist)\b/i.test(combined) ||
    /^\s*1\.\s+/m.test(body)
    ? "skill"
    : "rule";
};

const hasStrongGuidanceSignal = (title: string, lines: readonly string[]): boolean => {
  const combined = `${title}\n${lines.join("\n")}`;
  if (GUIDANCE_SIGNAL_PATTERN.test(combined)) {
    return true;
  }

  const longNaturalLines = lines.filter(
    (line) => line.length >= 24 && /[A-Za-z]/.test(line) && !isLikelyCommandLine(line),
  );
  return longNaturalLines.length >= 2;
};

const extractRelevantLines = (content: string): string[] =>
  stripCodeFences(content)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^[-*_]{3,}$/.test(line));

const splitMarkdownSections = (content: string): Array<{ title: string; body: string }> => {
  const lines = stripFrontmatter(content).split("\n");
  const sections: Array<{ title: string; body: string }> = [];

  let currentTitle: string | null = null;
  let currentBody: string[] = [];

  const pushCurrent = () => {
    if (currentTitle !== null) {
      sections.push({
        title: currentTitle,
        body: currentBody.join("\n").trim(),
      });
    }
  };

  for (const line of lines) {
    const headingMatch = /^(#{2,6})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      pushCurrent();
      const title = headingMatch[2];
      if (!title) {
        continue;
      }
      currentTitle = title.trim();
      currentBody = [];
      continue;
    }

    currentBody.push(line);
  }

  pushCurrent();
  return sections;
};

const extractCandidateFromSection = ({
  sourceRef,
  title,
  body,
}: {
  sourceRef: string;
  title: string;
  body: string;
}): GuidanceCandidate | null => {
  const lines = extractRelevantLines(body);
  if (lines.length < 2) {
    const singleLine = lines[0];
    if (
      singleLine === undefined ||
      singleLine.length < 12 ||
      isLikelyCommandLine(singleLine) ||
      !/[A-Za-z]/.test(singleLine)
    ) {
      return null;
    }

    return {
      sourceRef,
      title,
      summary: normalizeWhitespace(singleLine).slice(0, 180),
      kind: inferCandidateKind(title, body),
    };
  }

  const commandLines = lines.filter((line) => isLikelyCommandLine(line));
  const mostlyCommands = commandLines.length >= 3 && commandLines.length >= Math.ceil(lines.length * 0.6);
  if (mostlyCommands && !hasStrongGuidanceSignal(title, lines)) {
    return null;
  }

  if (!hasStrongGuidanceSignal(title, lines)) {
    return null;
  }

  const summary = toSummary(lines);
  if (summary.length < 24) {
    return null;
  }

  return {
    sourceRef,
    title,
    summary,
    kind: inferCandidateKind(title, body),
  };
};

const extractCandidatesFromContent = ({
  source,
  content,
}: {
  source: ExistingGuidanceSource;
  content: string;
}): { candidates: GuidanceCandidate[]; fullCoverage: boolean } => {
  const sanitizedContent = stripFrontmatter(content);
  const sections = splitMarkdownSections(sanitizedContent);
  const sourceLabel = path.basename(source.relativePath);
  const topLevelTitle = /^#\s+(.+)$/m.exec(sanitizedContent)?.[1]?.trim() ?? null;

  if (sections.length === 0) {
    const wholeFileCandidate = extractCandidateFromSection({
      sourceRef: source.relativePath,
      title: sourceLabel,
      body: sanitizedContent,
    });
    const titleOnlyCandidate =
      wholeFileCandidate === null && topLevelTitle !== null
        ? {
            sourceRef: source.relativePath,
            title: topLevelTitle,
            summary: topLevelTitle.slice(0, 180),
            kind: inferCandidateKind(topLevelTitle, sanitizedContent),
          }
        : null;

    return {
      candidates: wholeFileCandidate ? [wholeFileCandidate] : titleOnlyCandidate ? [titleOnlyCandidate] : [],
      fullCoverage: wholeFileCandidate !== null || titleOnlyCandidate !== null,
    };
  }

  const candidates: GuidanceCandidate[] = [];
  let skippedMeaningfulSections = 0;

  for (const section of sections) {
    const candidate = extractCandidateFromSection({
      sourceRef: source.relativePath,
      title: section.title,
      body: section.body,
    });

    if (candidate !== null) {
      candidates.push(candidate);
      continue;
    }

    if (extractRelevantLines(section.body).length >= 2) {
      skippedMeaningfulSections += 1;
    }
  }

  return {
    candidates,
    fullCoverage: candidates.length > 0 && skippedMeaningfulSections === 0,
  };
};

const readGuidanceContent = async (source: ExistingGuidanceSource): Promise<string | null> => {
  if (source.entryType !== "file") {
    return null;
  }

  const content = await readFile(source.path, "utf8");
  if (content.length > MAX_GUIDANCE_SOURCE_BYTES || content.includes("\u0000")) {
    return null;
  }

  const trimmed = content.trim();
  if (trimmed.length === 0 || isLikelyStructuredConfig(trimmed)) {
    return null;
  }

  return content;
};

export const extractReviewableGuidanceSources = async (
  discoveredSources: readonly ExistingGuidanceSource[],
): Promise<ReviewableGuidanceSource[]> => {
  const reviewableSources: ReviewableGuidanceSource[] = [];

  for (const source of discoveredSources) {
    const content = await readGuidanceContent(source);
    if (content === null) {
      continue;
    }

    const { candidates, fullCoverage } = extractCandidatesFromContent({
      source,
      content,
    });

    if (candidates.length === 0) {
      continue;
    }

    reviewableSources.push({
      ...source,
      candidates,
      fullCoverage,
    });
  }

  return reviewableSources;
};
