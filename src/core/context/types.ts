export const DETECTABLE_STACKS = ["nodejs", "typescript", "react", "nextjs", "angular"] as const;
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
  referenceProjects?: ReferenceProjectCandidate[];
};
