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

export type ResolvedMemoryBankStatus = "missing" | "ready" | "creation_declined";

export type ResolvedMemoryBankContext = ProjectContext & {
  status: ResolvedMemoryBankStatus;
  message: string;
  projectId: string;
  projectBankPath: string;
  rules: ResolvedContextEntry[];
  skills: ResolvedContextEntry[];
  agentInstructions: string;
};
