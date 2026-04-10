import type { ProjectCreationState } from "../bank/types.js";
import type { CanonicalRuleFrontmatter, CanonicalSkillFrontmatter } from "../bank/types.js";
import type { CreateFlowPhase } from "../projects/createFlowPhases.js";

export const DETECTABLE_STACKS = ["nodejs", "typescript", "react", "nextjs", "angular", "ios", "other"] as const;
export type DetectableStack = (typeof DETECTABLE_STACKS)[number];

export type DetectedSignal = {
  name: string;
  source: string;
};

export type LocalGuidanceSignal = {
  kind: "agents" | "cursor" | "claude" | "codex";
  path: string;
};

export type ProjectContext = {
  projectName: string;
  projectPath: string;
  detectedStacks: DetectableStack[];
  detectedSignals: DetectedSignal[];
  localGuidance: LocalGuidanceSignal[];
};

export type ResolvedContextEntry = {
  layer: "shared" | "project";
  path: string;
  reason: string;
  content: string;
  metadata: CanonicalRuleFrontmatter | CanonicalSkillFrontmatter;
};

export type ResolvedContextInlineRule = {
  scope: "shared" | "project";
  path: string;
  id: string;
  title: string;
  topics: string[];
  content: string;
};

export type ResolvedContextCatalogEntry = {
  scope: "shared" | "project";
  kind: "rules" | "skills";
  path: string;
  title: string;
  topics: string[];
  description?: string | null;
};

export type ReferenceProjectCandidate = {
  projectId: string;
  projectName: string;
  projectPath: string;
  projectBankPath: string;
  detectedStacks: DetectableStack[];
  sharedStacks: DetectableStack[];
};

export type ResolvedMemoryBankContext = {
  text: string;
  creationState?: ProjectCreationState;
  postponedUntil?: string | null;
  requiredAction?: "create_bank" | "continue_create_bank" | "sync_bank";
  recommendedAction?: "create_bank";
  createFlowPhase?: CreateFlowPhase;
  nextIteration?: number;
  detectedStacks?: DetectableStack[];
  rulesCatalog?: ResolvedContextCatalogEntry[];
  skillsCatalog?: ResolvedContextCatalogEntry[];
  referenceProjects?: ReferenceProjectCandidate[];
};
