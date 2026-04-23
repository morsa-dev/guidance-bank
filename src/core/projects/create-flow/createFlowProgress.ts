import { requiresCreateFlowStepOutcome } from "./createFlowPhases.js";

export type CreateFlowProgress = {
  effectiveIteration: number;
  stepCompletionRequired: boolean;
  stepOutcomeRequired: boolean;
};

export const resolveCreateFlowProgress = ({
  storedIteration,
  requestedIteration,
  stepCompleted,
  stepOutcomeSatisfied,
}: {
  storedIteration: number | null;
  requestedIteration: number;
  stepCompleted: boolean;
  stepOutcomeSatisfied: boolean;
}): CreateFlowProgress => {
  if (storedIteration === null) {
    return {
      effectiveIteration: requestedIteration,
      stepCompletionRequired: false,
      stepOutcomeRequired: false,
    };
  }

  if (requestedIteration === 0 || requestedIteration <= storedIteration) {
    return {
      effectiveIteration: requestedIteration,
      stepCompletionRequired: false,
      stepOutcomeRequired: false,
    };
  }

  if (requestedIteration === storedIteration + 1) {
    if (stepCompleted && requiresCreateFlowStepOutcome(storedIteration) && !stepOutcomeSatisfied) {
      return {
        effectiveIteration: storedIteration,
        stepCompletionRequired: false,
        stepOutcomeRequired: true,
      };
    }

    return stepCompleted
      ? {
          effectiveIteration: requestedIteration,
          stepCompletionRequired: false,
          stepOutcomeRequired: false,
        }
      : {
          effectiveIteration: storedIteration,
          stepCompletionRequired: true,
          stepOutcomeRequired: false,
        };
  }

  return {
    effectiveIteration: storedIteration,
    stepCompletionRequired: true,
    stepOutcomeRequired: false,
  };
};
