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
] as const;

const RECOMMENDED_OUTPUT_SHAPE = `## Recommended Output Shape

Aim for a right-sized bank, not a minimal placeholder:
- 2-6 focused rule files when project evidence supports them
- 2-5 focused skills when reusable workflows are clearly present
- for small or low-confidence projects, prefer fewer high-value entries over quota-filling

Common high-value starting points when evidence supports them:
- core/general
- architecture
- one stack- or workflow-specific topic
- adding-feature
- adding-service
- code-review
- task-based-reading or troubleshooting`;

export const renderCreateDeriveGuidance = (detectedStacks: readonly DetectableStack[]): string => {
  const sections = [GENERAL_DERIVE_GUIDANCE];

  for (const module of STACK_GUIDANCE_MODULES) {
    if (detectedStacks.includes(module.stack)) {
      sections.push(module.prompt);
    }
  }

  if (sections.length === 1) {
    sections.push(OTHER_DERIVE_GUIDANCE);
  }

  sections.push(RECOMMENDED_OUTPUT_SHAPE);

  return sections.join("\n\n");
};
