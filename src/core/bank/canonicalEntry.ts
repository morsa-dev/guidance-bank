import { z } from "zod";

import { DETECTABLE_STACKS } from "../context/types.js";
import type {
  CanonicalRuleDocument,
  CanonicalRuleFrontmatter,
  CanonicalSkillDocument,
  CanonicalSkillFrontmatter,
} from "./types.js";

const DetectableStackSchema = z.enum(DETECTABLE_STACKS);

const RuleFrontmatterSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.literal("rule"),
    title: z.string().trim().min(1),
    stacks: z.array(DetectableStackSchema).default([]),
    topics: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

const SkillFrontmatterSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.literal("skill"),
    title: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1),
    stacks: z.array(DetectableStackSchema).default([]),
    topics: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u;

type ParsedFrontmatter = {
  frontmatter: Record<string, unknown>;
  body: string;
};

const parseScalarValue = (rawValue: string): unknown => {
  const trimmedValue = rawValue.trim();

  if (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) {
    const innerValue = trimmedValue.slice(1, -1).trim();
    if (innerValue.length === 0) {
      return [];
    }

    return innerValue.split(",").map((item) => item.trim().replace(/^['"]|['"]$/gu, ""));
  }

  return trimmedValue.replace(/^['"]|['"]$/gu, "");
};

const parseFrontmatterBlock = (content: string): ParsedFrontmatter | null => {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return null;
  }

  const rawFrontmatter = match[1] ?? "";
  const body = match[2]?.trim() ?? "";
  const frontmatter: Record<string, unknown> = {};

  for (const line of rawFrontmatter.split(/\r?\n/u)) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid frontmatter line: ${trimmedLine}`);
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1);
    frontmatter[key] = parseScalarValue(rawValue);
  }

  return {
    frontmatter,
    body,
  };
};

const assertBody = (body: string): string => {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    throw new Error("Canonical entry body must not be empty.");
  }

  return trimmedBody;
};

export const parseCanonicalRuleDocument = (content: string): CanonicalRuleDocument => {
  const parsedContent = parseFrontmatterBlock(content);
  if (!parsedContent) {
    throw new Error("Canonical rule files must start with a frontmatter block.");
  }

  const frontmatter = RuleFrontmatterSchema.parse(parsedContent.frontmatter);

  return {
    frontmatter,
    body: assertBody(parsedContent.body),
  };
};

export const parseCanonicalSkillDocument = (content: string): CanonicalSkillDocument => {
  const parsedContent = parseFrontmatterBlock(content);
  if (!parsedContent) {
    throw new Error("Canonical skill files must start with a frontmatter block.");
  }

  const frontmatter = SkillFrontmatterSchema.parse(parsedContent.frontmatter);

  return {
    frontmatter,
    body: assertBody(parsedContent.body),
  };
};

export const parseCanonicalRuleDocumentOptional = (
  content: string,
): { document: CanonicalRuleDocument | null; hasFrontmatter: boolean } => {
  const hasFrontmatter = FRONTMATTER_PATTERN.test(content);
  if (!hasFrontmatter) {
    return {
      document: null,
      hasFrontmatter: false,
    };
  }

  return {
    document: parseCanonicalRuleDocument(content),
    hasFrontmatter: true,
  };
};

export const parseCanonicalSkillDocumentOptional = (
  content: string,
): { document: CanonicalSkillDocument | null; hasFrontmatter: boolean } => {
  const hasFrontmatter = FRONTMATTER_PATTERN.test(content);
  if (!hasFrontmatter) {
    return {
      document: null,
      hasFrontmatter: false,
    };
  }

  return {
    document: parseCanonicalSkillDocument(content),
    hasFrontmatter: true,
  };
};

export const serializeCanonicalRuleFrontmatter = (frontmatter: CanonicalRuleFrontmatter): string => `---
id: ${frontmatter.id}
kind: rule
title: ${frontmatter.title}
stacks: [${frontmatter.stacks.join(", ")}]
topics: [${frontmatter.topics.join(", ")}]
---`;

export const serializeCanonicalSkillFrontmatter = (frontmatter: CanonicalSkillFrontmatter): string => `---
id: ${frontmatter.id}
kind: skill
title: ${frontmatter.title}
${frontmatter.name ? `name: ${frontmatter.name}
` : ""}description: ${frontmatter.description}
stacks: [${frontmatter.stacks.join(", ")}]
topics: [${frontmatter.topics.join(", ")}]
---`;
