import {
  createProjectBankState,
  markProjectBankSynced,
  setProjectBankCreatePhase,
  setProjectBankSourceStrategies,
} from "../../bank/project.js";
import type { ProjectBankManifest, ProjectBankState, ProjectCreationState } from "../../bank/types.js";
import { getCreateFlowPhase, type CreateIterationPhase } from "./createFlowPhases.js";
import type { ConfirmedGuidanceSourceStrategy } from "./guidanceStrategies.js";

export const resolveNextCreateBankState = ({
  existingManifest,
  existingState,
  shouldTrackCreateFlow,
  nextCreationState,
  manifestStorageVersion,
  effectiveIteration,
  confirmedSourceStrategies,
}: {
  existingManifest: ProjectBankManifest | null;
  existingState: ProjectBankState | null;
  shouldTrackCreateFlow: boolean;
  nextCreationState: ProjectCreationState;
  manifestStorageVersion: number;
  effectiveIteration: number;
  confirmedSourceStrategies: ConfirmedGuidanceSourceStrategy[];
}): ProjectBankState => {
  let nextState = existingState;

  if (existingManifest === null) {
    nextState = markProjectBankSynced(createProjectBankState(nextCreationState), manifestStorageVersion);
  } else if (nextState === null) {
    nextState = createProjectBankState(nextCreationState);
  } else if (shouldTrackCreateFlow) {
    nextState = {
      ...nextState,
      creationState: nextCreationState,
    };
  }

  if (shouldTrackCreateFlow) {
    nextState = setProjectBankCreatePhase(nextState, getCreateFlowPhase(effectiveIteration) as CreateIterationPhase);
    nextState = setProjectBankSourceStrategies(
      nextState,
      nextCreationState === "ready" ? [] : confirmedSourceStrategies,
    );
  }

  return nextState;
};
