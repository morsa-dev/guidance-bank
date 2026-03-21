import type { DetectableStack, LocalGuidanceSignal } from "../context/types.js";
import type { ProjectCreationState } from "../bank/types.js";

export type LayerValidationSummary = {
  rules: number;
  skills: number;
};

export type SyncResult = {
  action: "run" | "postpone";
  bankRoot: string;
  projectPath: string;
  detectedStacks: DetectableStack[];
  projectState: ProjectCreationState;
  postponedUntil: string | null;
  projectManifestUpdated: boolean;
  validatedEntries: {
    shared: LayerValidationSummary;
    project: LayerValidationSummary;
  };
  externalGuidanceSources: LocalGuidanceSignal[];
};
