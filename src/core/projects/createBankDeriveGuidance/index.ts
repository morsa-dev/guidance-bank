import type { DetectableStack } from "../../context/types.js";

import { ANGULAR_DERIVE_GUIDANCE } from "./stacks/angular.js";
import { IOS_DERIVE_GUIDANCE } from "./stacks/ios.js";
import { NEXTJS_DERIVE_GUIDANCE } from "./stacks/nextjs.js";
import { NODEJS_DERIVE_GUIDANCE } from "./stacks/nodejs.js";
import { OTHER_DERIVE_GUIDANCE } from "./stacks/other.js";
import { REACT_DERIVE_GUIDANCE } from "./stacks/react.js";
import { GENERAL_DERIVE_GUIDANCE } from "./shared/general.js";
import { TYPESCRIPT_DERIVE_GUIDANCE } from "./shared/typescript.js";

type StackGuidanceModule = {
  stack: DetectableStack;
  prompt: string;
};

const STACK_GUIDANCE_MODULES: readonly StackGuidanceModule[] = [
  { stack: "typescript", prompt: TYPESCRIPT_DERIVE_GUIDANCE },
  { stack: "nextjs", prompt: NEXTJS_DERIVE_GUIDANCE },
  { stack: "react", prompt: REACT_DERIVE_GUIDANCE },
  { stack: "angular", prompt: ANGULAR_DERIVE_GUIDANCE },
  { stack: "nodejs", prompt: NODEJS_DERIVE_GUIDANCE },
  { stack: "ios", prompt: IOS_DERIVE_GUIDANCE },
  { stack: "other", prompt: OTHER_DERIVE_GUIDANCE },
] as const;

const RECOMMENDED_OUTPUT_SHAPE = `## Recommended Output Shape

Aim for a right-sized bank, not a minimal placeholder:
- for non-trivial projects, expect at least 5 focused rule files when project evidence supports them
- for non-trivial projects, expect at least 3 focused skills when reusable workflows are clearly present
- treat those counts as minimum expectations, not caps
- go lower only when the project clearly lacks architectural depth — limited distinct patterns, unclear stack, or a codebase too small to support meaningful rules — and record the reason explicitly
- do not force entries when the evidence is not there: a project with a handful of files and no clear patterns does not need invented rules
- do not stop at a thin summary when the repository clearly supports more

## Candidate Derivation Requirements

Before drafting the final derive batch:
- infer the project archetype from entrypoints, commands, configs, integrations, and storage layout
- adapt the candidate list to that archetype instead of relying only on generic stack defaults
- if the repository looks like a CLI, MCP server, local tooling runtime, provider integration layer, or workflow engine, evaluate candidates that match that surface directly

Coverage matrix:
- architecture and dependency boundaries
- testing or contract surface
- custom authoring, storage, or format constraints
- provider, integration, or external interface contracts
- key multi-step workflows: identify at least 2 when the repository supports them
- recurring anti-patterns, failure modes, or troubleshooting patterns

For each coverage category above, do one of the following before concluding derive/finalize:
- create or update a rule/skill
- merge the guidance into a clearer existing entry
- record a one-sentence skip reason

Common high-value starting points when evidence supports them:
- core/general
- architecture
- one stack- or workflow-specific topic
- adding-feature
- adding-service
- code-review
- task-based-reading or troubleshooting
- CLI or MCP workflow skills such as adding-tooling-surface, verifying-mcp-service, improving-existing-bank, provider-integration-workflows, or troubleshooting-flow-state when the repository evidence supports them

Before concluding derive/finalize:
- confirm the bank is not materially weaker than the strongest evidence found in the coverage matrix
- review the strongest missing rule and skill candidates
- stop only when additional entries would mostly duplicate existing guidance, restate weak evidence, or split the bank into overly fine-grained fragments
- either create them, merge them into clearer existing entries, or record a skip reason`;

export const renderCreateDeriveGuidance = (detectedStacks: readonly DetectableStack[]): string => {
  const sections = [GENERAL_DERIVE_GUIDANCE];

  for (const module of STACK_GUIDANCE_MODULES) {
    if (detectedStacks.includes(module.stack)) {
      sections.push(module.prompt);
    }
  }

  sections.push(RECOMMENDED_OUTPUT_SHAPE);

  return sections.join("\n\n");
};
