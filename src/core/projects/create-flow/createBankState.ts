import {
  createProjectBankState,
  markProjectBankSynced,
  setProjectBankCreateIteration,
  setProjectBankSourceStrategies,
} from "../../bank/project.js";
import type { ProjectBankManifest, ProjectBankState, ProjectCreationState } from "../../bank/types.js";
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
    nextState = setProjectBankCreateIteration(nextState, effectiveIteration);
    nextState = setProjectBankSourceStrategies(
      nextState,
      nextCreationState === "ready" ? [] : confirmedSourceStrategies,
    );
  }

  return nextState;
};
