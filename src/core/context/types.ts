export const DETECTABLE_STACKS = ["nodejs", "typescript", "react", "nextjs", "angular"] as const;
export type DetectableStack = (typeof DETECTABLE_STACKS)[number];

export type DetectedSignal = {
  name: string;
  source: string;
};

export type ProjectContext = {
  cwd: string;
  projectName: string;
  detectedStacks: DetectableStack[];
  detectedSignals: DetectedSignal[];
};

export type ResolvedContextEntry = {
  path: string;
  reason: string;
  content: string;
};

export type ResolvedMemoryBankContext = ProjectContext & {
  provider?: string;
  task?: string;
  rules: ResolvedContextEntry[];
  skills: ResolvedContextEntry[];
  agentInstructions: string;
};
